package redis

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/mediocregopher/radix.v2/pool"
	"github.com/mediocregopher/radix.v2/pubsub"
	"github.com/mediocregopher/radix.v2/redis"
	"github.com/mediocregopher/radix.v2/util"
	"github.com/yerden/go-util/common"
)

type RedisConfig struct {
	Network, Addr string
	DbIndex       int
}

// event types
const (
	EventExpire = iota
	EventExpired
	EventDel
)

const (
	queryChannelBuf    = 128
	queryDrainInterval = 100 * time.Millisecond
)

type Redis struct {
	pool  *pool.Pool
	index int
}

func getEvent(channel string) string {
	return strings.SplitN(channel, ":", 2)[1]
}

var _ common.Scanner = (*events)(nil)

type events struct {
	r      *Redis
	filter string
	cl     *redis.Client
	subcl  *pubsub.SubClient

	// next event
	err error
	typ int
	key string
}

func (e *events) Type() int {
	return e.typ
}

func (e *events) Bytes() []byte {
	return []byte(e.key)
}

func (e *events) Text() string {
	return e.key
}

func (e *events) Err() error {
	return e.err
}

func logIfErr(prefix string, err error) {
	if err != nil {
		log.Println(prefix + ": " + err.Error())
	}
}

func NewRedis(c RedisConfig) (*Redis, error) {
	db := fmt.Sprintf("%d", c.DbIndex)
	df := func(network, addr string) (*redis.Client, error) {
		cl, err := redis.Dial(network, addr)
		if err != nil {
			return nil, err
		}
		if err = cl.Cmd("SELECT", db).Err; err != nil {
			cl.Close()
			return nil, err
		}
		return cl, nil
	}
	redisPool, err := pool.NewCustom(c.Network, c.Addr, 10, df)
	return &Redis{pool: redisPool, index: c.DbIndex}, err
}

func (r *Redis) Get(key string) (string, error) {
	return r.pool.Cmd("GET", key).Str()
}

func (r *Redis) NewKeyEventSource() common.ScanCloser {
	e := &events{
		r:      r,
		filter: fmt.Sprintf("__keyevent@%d__:*", r.index)}
	return e
}

func (e *events) disconnect() {
	if e.cl != nil {
		e.cl.Close()
		e.cl = nil
	}
	e.subcl = nil
}

func (e *events) Close() {
	e.disconnect()
}

func (e *events) connect() bool {
	e.cl, e.err = e.r.pool.Get()
	if e.err != nil {
		return false
	}

	e.subcl = pubsub.NewSubClient(e.cl)
	resp := e.subcl.PSubscribe(e.filter)
	e.err = resp.Err
	return e.err == nil
}

func (e *events) Scan() bool {
	for {
		if e.subcl == nil && !e.connect() {
			return false
		}
		resp := e.subcl.Receive()
		if resp.Timeout() {
			// "You can use the Timeout() method on
			// SubResp to easily determine if that
			// is the case. If this is the case you
			// can call Receive again to continue
			// listening for publishes."
			continue
		} else if resp.Err == io.EOF {
			// XXX: sometimes redis connection closes with EOF,
			// fetch new one and retry
			e.disconnect()
			if !e.connect() {
				return false
			}
			continue
		} else if e.err = resp.Err; e.err != nil {
			return false
		} else if resp.Type != pubsub.Message {
			continue
		}

		key, event := resp.Message, getEvent(resp.Channel)
		e.err = nil
		e.key = key
		switch event {
		case "expire":
			e.typ = EventExpire
		case "expired":
			e.typ = EventExpired
		case "del":
			e.typ = EventDel
		}
		return true
	}
}

func (r *Redis) mGet(args, values []interface{}) ([]interface{}, error) {
	array, err := r.pool.Cmd("MGET", args...).Array()
	if err != nil {
		return nil, err
	}
	values = append(values[:0], make([]interface{}, len(args))...)
	for i, r := range array {
		if v, err := r.Str(); err == nil {
			values[i] = v
		} else { // if r.IsType(redis.Nil) {
			values[i] = nil
		}
	}
	return values, nil
}

// k/v pair handler
// if v argument in TupleOp is nil then k is absent from db
// may also be used for iteration, then the bool
// return value may be used to exit iteration
type TupleOp func(k, v interface{}) bool

// get keys from Scanner, GET them from redis, then
// process them via TupleOp
// if TupleOp returns false: stop and return latest error value
// if error is encountered, finish and return it.
func (r *Redis) ConsumeScanner(ctx context.Context, s common.Scanner, fn TupleOp) error {
	ch := make(chan interface{}, queryChannelBuf)
	errCh := make(chan error, 1)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func(ctx context.Context) {
		errCh <- r.ConsumeKeyChan(ctx, ch, fn)
	}(ctx)

	for s.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ch <- s.Text():
		case err := <-errCh:
			return err
		}
	}

	return s.Err()
}

type utilScanner struct {
	util.Scanner
}

func (s *utilScanner) Bytes() []byte {
	return []byte(s.Next())
}

func (s *utilScanner) Text() string {
	return s.Next()
}

func (s *utilScanner) Scan() bool {
	return s.HasNext()
}

func (r *Redis) NewScanner(window int) common.Scanner {
	return &utilScanner{util.NewScanner(r.pool,
		util.ScanOpts{Command: "SCAN", Count: window})}
}

func (r *Redis) ConsumeKeyChan(ctx context.Context, ch <-chan interface{}, fn TupleOp) error {
	buf := make([]interface{}, 0, queryChannelBuf)
	values := make([]interface{}, 0, queryChannelBuf)
	ticker := time.NewTicker(queryDrainInterval)
	defer ticker.Stop()
	var k interface{}
	var ok bool = true
	for ok {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case k, ok = <-ch:
			if ok {
				if buf = append(buf, k); len(buf) < cap(buf) {
					continue
				}
			}
		case <-ticker.C:
			if len(buf) == 0 {
				continue
			}
		}
		values, err := r.mGet(buf, values)
		if err != nil {
			return err
		}
		for i, key := range buf {
			fn(key, values[i])
		}
		buf = buf[:0]
	}
	return nil
}

package deduper

import (
	"github.com/yerden/go-util/assert"
	"math/rand"
	"testing"
)

type myInt int

func (x myInt) Key() interface{} { return x }

func TestDeduperUnique(t *testing.T) {
	a := assert.New(t)

	d := New(DeduperConfig{MaxEntries: 100})
	input := []myInt{0, 1, 2, 3, 4, 5}

	for _, in := range input {
		_, _, out := d.Consume(in)
		a.True(out)
	}
}

func TestDeduperRepeat1(t *testing.T) {
	a := assert.New(t)

	d := New(DeduperConfig{MaxEntries: 100})

	n := 0
	for i := 0; i < 200; i++ {
		if _, _, ok := d.Consume(myInt(rand.Int() % 100)); ok {
			n++
		}
	}
	a.True(n <= 100)
}

func TestDeduperRepeat2(t *testing.T) {
	a := assert.New(t)

	d := New(DeduperConfig{MaxEntries: 100})
	input := []myInt{0, 1, 1, 1, 2, 3, 2, 2, 3, 4, 5}
	output := []myInt{}

	for _, in := range input {
		if _, _, ok := d.Consume(in); ok {
			output = append(output, in)
		}
	}

	for i, _ := range output {
		a.Equal(myInt(i), output[i])
	}
}

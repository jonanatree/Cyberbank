package issuer

import (
    "context"
    "fmt"
    "io"
    "net"
    "net/http"
    "time"
    "sync"
    "os"
    "database/sql"
    "strconv"

    "github.com/alovak/cardflow-playground/internal/middleware"
    "github.com/alovak/cardflow-playground/internal/expiry"
    // "github.com/alovak/cardflow-playground/issuer"
    issuer8583 "github.com/alovak/cardflow-playground/issuer/iso8583"
    "github.com/go-chi/chi/v5"
    "golang.org/x/exp/slog"
    _ "github.com/lib/pq"
)

// App is the main application, it contains all the components of the issuer service
// and is responsible for starting and stopping them.
type App struct {
	srv               *http.Server
	wg                *sync.WaitGroup
	Addr              string
	ISO8583ServerAddr string
	logger            *slog.Logger
	iso8583Server     io.Closer
	config            *Config
}

func NewApp(logger *slog.Logger, config *Config) *App {
	logger = logger.With(slog.String("app", "issuer"))

	if config == nil {
		config = DefaultConfig()
	}

	return &App{
		wg:     &sync.WaitGroup{},
		logger: logger,
		config: config,
	}
}

func (a *App) Start() error {
    a.logger.Info("starting app...")

    // setup the issuer
    router := chi.NewRouter()
    router.Use(middleware.NewStructuredLogger(a.logger))
    // Choose repository backend: default to pg for runtime; allow mem only when explicitly enabled for tests
    var repository *Repository
    backend := getenv("REPO_BACKEND", "pg")
    allowMem := getenv("ALLOW_MEM_BACKEND_FOR_TESTS", "false") == "true"
    switch backend {
    case "pg":
        dsn := getenv("DB_DSN", "")
        if dsn == "" {
            return fmt.Errorf("DB_DSN is required for pg backend")
        }
        db, err := sql.Open("postgres", dsn)
        if err != nil {
            return fmt.Errorf("open postgres: %w", err)
        }
        db.SetMaxIdleConns(5)
        db.SetMaxOpenConns(10)
        if err := db.Ping(); err != nil {
            return fmt.Errorf("ping postgres: %w", err)
        }
        hashKey := []byte(getenv("PAN_HASH_KEY", "dev-secret-pepper"))
        repository = NewPGRepository(db, hashKey)
    case "mem":
        if !allowMem {
            return fmt.Errorf("mem repository is disabled at runtime; set ALLOW_MEM_BACKEND_FOR_TESTS=true only in tests")
        }
        repository = NewRepository()
    default:
        return fmt.Errorf("unsupported REPO_BACKEND=%s", backend)
    }
    // Wire expiry configuration from app config
    if a.config != nil {
        // Timezone
        if a.config.ExpiryTZ != "" {
            if loc, err := time.LoadLocation(a.config.ExpiryTZ); err == nil {
                expiry.SetDefaultExpiryLocation(loc)
            } else {
                a.logger.Info("invalid ExpiryTZ; using default UTC", slog.String("tz", a.config.ExpiryTZ), slog.Any("err", err))
            }
        }
        // Product years mapping
        if len(a.config.ProductYears) > 0 {
            expiry.SetProductYears(a.config.ProductYears)
        }
    }

    iss := NewService(repository, a.config)

	iso8583Server := issuer8583.NewServer(a.logger, a.config.ISO8583Addr, iss)
	err := iso8583Server.Start()
	if err != nil {
		return fmt.Errorf("starting iso8583 server: %w", err)
	}
	a.ISO8583ServerAddr = iso8583Server.Addr
	a.iso8583Server = iso8583Server

    api := NewAPI(iss)
    api.AppendRoutes(router)

    // Health and simple admin endpoints
    router.Get("/-/live", func(w http.ResponseWriter, r *http.Request){ w.WriteHeader(http.StatusOK) })
    router.Get("/-/ready", func(w http.ResponseWriter, r *http.Request){
        ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second); defer cancel()
        if err := repository.Ping(ctx); err != nil {
            http.Error(w, "db not ready", http.StatusServiceUnavailable); return
        }
        w.WriteHeader(http.StatusOK)
    })
    router.Post("/dev/holds/release", func(w http.ResponseWriter, r *http.Request){
        ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second); defer cancel()
        n, err := repository.ReleaseExpiredHolds(ctx, 500)
        if err != nil { http.Error(w, err.Error(), http.StatusInternalServerError); return }
        w.Header().Set("Content-Type", "application/json")
        w.Write([]byte(fmt.Sprintf("{\"released\":%d}", n)))
    })
    router.Post("/dev/auths/{id}/capture", func(w http.ResponseWriter, r *http.Request){
        if repository.db == nil { http.Error(w, "not implemented for memory backend", http.StatusNotImplemented); return }
        id := chi.URLParam(r, "id")
        amtStr := r.URL.Query().Get("amount")
        var amt int64 = 0 // 0 => full capture
        if amtStr != "" { if v, err := strconv.ParseInt(amtStr, 10, 64); err == nil { amt = v } }
        cur := r.URL.Query().Get("currency")
        if cur == "" { cur = "USD" }
        ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second); defer cancel()
        if err := repository.CaptureAuth(ctx, id, amt, cur); err != nil { http.Error(w, err.Error(), http.StatusBadRequest); return }
        w.WriteHeader(http.StatusNoContent)
    })
    router.Post("/dev/auths/{id}/reverse", func(w http.ResponseWriter, r *http.Request){
        if repository.db == nil { http.Error(w, "not implemented for memory backend", http.StatusNotImplemented); return }
        id := chi.URLParam(r, "id")
        ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second); defer cancel()
        if err := repository.ReverseAuth(ctx, id); err != nil { http.Error(w, err.Error(), http.StatusBadRequest); return }
        w.WriteHeader(http.StatusNoContent)
    })

	l, err := net.Listen("tcp", a.config.HTTPAddr)
	if err != nil {
		return fmt.Errorf("listening tcp port: %w", err)
	}

	a.Addr = l.Addr().String()

	a.srv = &http.Server{
		Handler: router,
	}

	a.wg.Add(1)
	go func() {
		a.logger.Info("http server started", slog.String("addr", a.Addr))

		if err := a.srv.Serve(l); err != nil {
			if err != http.ErrServerClosed {
				a.logger.Error("starting http server", "err", err)
			}

			a.logger.Info("http server stopped")
		}

		a.wg.Done()
	}()

	return nil
}

func getenv(k, def string) string {
    if v := os.Getenv(k); v != "" {
        return v
    }
    return def
}

func (a *App) Shutdown() {
	a.logger.Info("shutting down app...")

	a.srv.Shutdown(context.Background())

	err := a.iso8583Server.Close()
	if err != nil {
		a.logger.Error("closing iso8583 server", "err", err)
	}

	a.wg.Wait()

	a.logger.Info("app stopped")
}

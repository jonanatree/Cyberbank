package acquirer

import "os"

type Config struct {
	HTTPAddr    string
	ISO8583Addr string
}

func DefaultConfig() *Config {
	return &Config{
		HTTPAddr:    getenv("ACQUIRER_HTTP_ADDR", "0.0.0.0:8080"),
		ISO8583Addr: getenv("ISO8583_ADDR", "127.0.0.1:8583"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

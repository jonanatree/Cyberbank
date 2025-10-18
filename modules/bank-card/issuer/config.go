package issuer

// Config is a configuration for the issuer application
type Config struct {
    HTTPAddr    string
    ISO8583Addr string
    // ExpiryTZ is an IANA timezone name for expiry computations (e.g., "Australia/Sydney").
    ExpiryTZ string
    // ProductYears maps card product to validity years (e.g., credit=3, debit=5).
    ProductYears map[string]int
    // CardProduct is the default product used by auto-issued cards (e.g., "debit").
    CardProduct string
    // BINPrefix sets the issuer BIN prefix used to generate PANs (6/8/9 digits). Demo default: 421234
    BINPrefix string
}

func DefaultConfig() *Config {
    return &Config{
        HTTPAddr:    "localhost:9090",
        ISO8583Addr: "localhost:8583",
        CardProduct: "debit",
        BINPrefix:   "421234",
    }
}

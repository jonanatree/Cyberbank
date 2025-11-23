package issuer

import (
    "strings"
    "time"
)

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
    // DefaultCurrencyCode overrides fallback currency when core bank response lacks code.
    DefaultCurrencyCode string
    // Core bank connectivity
    CoreBankBaseURL       string
    CoreBankAuthToken     string
    CoreBankTenantID      string
    CoreBankTimeoutSeconds int
    // Core savings sub-statuses that are forbidden for issuance.
    ForbiddenSubStatus []string
}

func DefaultConfig() *Config {
	return &Config{
		HTTPAddr:    "0.0.0.0:9090",
		ISO8583Addr: "0.0.0.0:8583",
		CardProduct: "debit",
		BINPrefix:   "421234",
	}
}

func (c *Config) DefaultCurrency() string {
    if c == nil {
        return ""
    }
    return c.DefaultCurrencyCode
}

func (c *Config) coreBankTimeout() time.Duration {
    if c == nil || c.CoreBankTimeoutSeconds <= 0 {
        return 5 * time.Second
    }
    return time.Duration(c.CoreBankTimeoutSeconds) * time.Second
}

func (c *Config) forbiddenSubStatusSet() map[string]struct{} {
    set := map[string]struct{}{}
    if c == nil {
        return set
    }
    // default forbidden list
    defaults := []string{"BLOCK", "BLOCK_CREDIT", "BLOCK_DEBIT", "ESCHEAT", "INACTIVE", "DORMANT"}
    active := defaults
    if len(c.ForbiddenSubStatus) > 0 {
        active = c.ForbiddenSubStatus
    }
    for _, v := range active {
        set[strings.ToUpper(v)] = struct{}{}
    }
    return set
}

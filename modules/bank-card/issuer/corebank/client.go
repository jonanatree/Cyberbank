package corebank

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "net/url"
    "strings"
    "time"
)

// SavingsAccount is a trimmed view of the core savings account used for issuance validation.
type SavingsAccount struct {
    ID              int64               `json:"id"`
    AccountNo       string              `json:"accountNo"`
    ExternalID      string              `json:"externalId"`
    ClientID        int64               `json:"clientId"`
    SavingsProductID int64              `json:"savingsProductId"`
    Status          Status              `json:"status"`
    SubStatus       SubStatus           `json:"subStatus"`
    Timeline        Timeline            `json:"timeline"`
    Currency        Currency            `json:"currency"`
}

type Status struct {
    ID     int    `json:"id"`
    Code   string `json:"code"`
    Value  string `json:"value"`
    Active bool   `json:"active"`
}

type SubStatus struct {
    ID    *int   `json:"id,omitempty"`
    Code  string `json:"code"`
    Value string `json:"value"`
}

type Timeline struct {
    ActivatedOnDate []int `json:"activatedOnDate"`
}

type Currency struct {
    Code string `json:"code"`
}

// Client wraps HTTP calls to core bank.
type Client struct {
    baseURL   string
    tenantID  string
    authToken string
    httpClient *http.Client
}

// NewClient creates a core bank client.
func NewClient(baseURL, authToken, tenantID string, timeout time.Duration) *Client {
    if timeout == 0 {
        timeout = 5 * time.Second
    }
    return &Client{
        baseURL:    strings.TrimRight(baseURL, "/"),
        tenantID:   tenantID,
        authToken:  authToken,
        httpClient: &http.Client{Timeout: timeout},
    }
}

// GetSavingsAccount obtains a savings account by id or externalId.
func (c *Client) GetSavingsAccount(ctx context.Context, id, externalID string) (SavingsAccount, error) {
    var target string
    if id != "" {
        target = fmt.Sprintf("%s/v1/savingsaccounts/%s", c.baseURL, url.PathEscape(id))
    } else {
        target = fmt.Sprintf("%s/v1/savingsaccounts/external-id/%s", c.baseURL, url.PathEscape(externalID))
    }
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
    if err != nil {
        return SavingsAccount{}, err
    }
    if c.authToken != "" {
        req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.authToken))
    }
    if c.tenantID != "" {
        req.Header.Set("Fineract-Platform-TenantId", c.tenantID)
    }
    resp, err := c.httpClient.Do(req)
    if err != nil {
        return SavingsAccount{}, err
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return SavingsAccount{}, fmt.Errorf("core bank returned status %d", resp.StatusCode)
    }
    var data SavingsAccount
    if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
        return SavingsAccount{}, err
    }
    return data, nil
}

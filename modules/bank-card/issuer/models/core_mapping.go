package models

import "time"

// IssueCardFromCoreRequest carries the data required to fetch and validate a core savings account.
type IssueCardFromCoreRequest struct {
    CoreAccountID string `json:"core_account_id"` // corebank internal ID only
    ExternalID    string `json:"external_id,omitempty"`
    CustomerID    int64  `json:"customer_id,omitempty"` // corebank clientId
    RequestID     string `json:"request_id"`            // idempotency key
}

// IssueCardFromCoreResponse returns the created or existing card along with core mapping fields.
type IssueCardFromCoreResponse struct {
    CardID        string `json:"card_id"`
    CardFace      string `json:"card_face"`
    CoreAccountID string `json:"core_account_id"`
    AccountNo     string `json:"account_no,omitempty"`
    ExternalID    string `json:"external_id,omitempty"`
    CustomerID    int64  `json:"customer_id,omitempty"`
    ProductID     int64  `json:"product_id,omitempty"`
    CurrencyCode  string `json:"currency_code,omitempty"`
    ActivatedOn   string `json:"activated_on,omitempty"`
    CoreStatus    string `json:"core_status"`
    CoreSubStatus string `json:"core_sub_status,omitempty"`
    LinkStatus    string `json:"link_status,omitempty"`
    LastCoreSyncAt string `json:"last_core_sync_at,omitempty"`
    LastCoreSyncResult string `json:"last_core_sync_result,omitempty"`
    RequestID     string `json:"request_id"`
}

// CardAccountLink persists the mapping between a card and its core savings account.
type CardAccountLink struct {
    CardID        string
    CoreAccountID string
    AccountNo     string
    ExternalID    string
    CustomerID    int64
    ProductID     int64
    CurrencyCode  string
    ActivatedOn   *time.Time
    CoreStatus    string
    CoreSubStatus string
    LinkStatus    string
    RequestID     string
    LastCoreSyncAt *time.Time
    LastCoreSyncResult string
}

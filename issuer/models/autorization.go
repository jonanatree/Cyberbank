package models

type AuthorizationRequest struct {
    Amount   int64
    Currency string
    Card     Card
    Merchant Merchant
    // Optional STAN (DE11) for idempotency; nil when not provided
    STAN     *int
}

type AuthorizationResponse struct {
	AuthorizationCode string
	ApprovalCode      string
}

package models

type Card struct {
    ID                    string
    AccountID             string
    Number                string
    ExpirationDate        string
    CardVerificationValue string
    // CardholderName is the user-provided name to display on card face
    CardholderName        string
}

package issuer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/alovak/cardflow-playground/issuer/models"
	"github.com/go-chi/chi/v5"
)

// API is a HTTP API for the issuer service
type API struct {
	issuer *Service
}

func NewAPI(issuer *Service) *API {
	return &API{
		issuer: issuer,
	}
}

func (a *API) AppendRoutes(r chi.Router) {
    r.Route("/accounts", func(r chi.Router) {
        r.Post("/", a.createAccount)
        r.Route("/{accountID}", func(r chi.Router) {
            r.Get("/", a.getAccount)
            r.Post("/cards", a.issueCard)
            // Allow setting cardholder name after card issuance (Core Bank link step)
            r.Post("/cards/{cardID}/holder", a.setCardholderName)
            r.Get("/transactions", a.getTransactions)
        })
    })
}

func (a *API) createAccount(w http.ResponseWriter, r *http.Request) {
	create := models.CreateAccount{}
	err := json.NewDecoder(r.Body).Decode(&create)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	account, err := a.issuer.CreateAccount(create)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(account)
}

func (a *API) getAccount(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")

	account, err := a.issuer.GetAccount(accountID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(account)
}

func (a *API) issueCard(w http.ResponseWriter, r *http.Request) {
    accountID := chi.URLParam(r, "accountID")

    card, err := a.issuer.IssueCard(accountID)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    // augment with card face "MM/YY [NAME]" to reduce caller burden
    face := formatCardFace(card.ExpirationDate, card.CardholderName)
    json.NewEncoder(w).Encode(struct{
        *models.Card
        CardFace string `json:"card_face"`
    }{card, face})
}

// setCardholderName allows the user to set a cardholder name after linking with Core Bank.
// Request body: {"cardholder_name": "JOHN DOE"}
func (a *API) setCardholderName(w http.ResponseWriter, r *http.Request) {
    accountID := chi.URLParam(r, "accountID")
    cardID := chi.URLParam(r, "cardID")
    var body struct {
        CardholderName string `json:"cardholder_name"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    if body.CardholderName == "" {
        http.Error(w, "cardholder_name is required", http.StatusBadRequest)
        return
    }
    updated, err := a.issuer.SetCardholderName(accountID, cardID, body.CardholderName)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            http.Error(w, err.Error(), http.StatusNotFound)
        } else {
            http.Error(w, err.Error(), http.StatusBadRequest)
        }
        return
    }
    // Build face using stored expiry (repo keeps YYMM in memory); function handles both formats.
    face := formatCardFace(updated.ExpirationDate, updated.CardholderName)
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(struct{
        *models.Card
        CardFace string `json:"card_face"`
    }{updated, face})
}

// formatCardFace returns "MM/YY [NAME]" if name provided; accepts expiry in YYMM or MMYY.
func formatCardFace(exp, name string) string {
    mm, yy := "", ""
    if len(exp) == 4 {
        // Detect if first two are a valid month; if not, assume YYMM
        first := exp[:2]
        last := exp[2:]
        if first >= "01" && first <= "12" {
            mm, yy = first, last
        } else {
            mm, yy = last, first
        }
    }
    face := ""
    if mm != "" && yy != "" { face = mm + "/" + yy }
    if name != "" {
        if face != "" { face += " " }
        face += name
    }
    return face
}

func (a *API) getTransactions(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")

	transactions, err := a.issuer.ListTransactions(accountID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(transactions)
}

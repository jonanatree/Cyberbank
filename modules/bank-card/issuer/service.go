package issuer

import (
    "errors"
    "fmt"
    "math/rand"
    "time"
    "context"

    "github.com/alovak/cardflow-playground/issuer/models"
    "github.com/google/uuid"
    "github.com/alovak/cardflow-playground/internal/expiry"
    "github.com/alovak/cardflow-playground/internal/cardgen"
)

type Service struct {
    repo *Repository
    cfg  *Config
}

func NewService(repo *Repository, cfg *Config) *Service {
    return &Service{
        repo: repo,
        cfg:  cfg,
    }
}

func (i *Service) CreateAccount(req models.CreateAccount) (*models.Account, error) {
	account := &models.Account{
		ID:               uuid.New().String(),
		AvailableBalance: req.Balance,
		Currency:         req.Currency,
	}

	err := i.repo.CreateAccount(account)
	if err != nil {
		return nil, fmt.Errorf("creating account: %w", err)
	}

	return account, nil
}

func (i *Service) GetAccount(accountID string) (*models.Account, error) {
	account, err := i.repo.GetAccount(accountID)
	if err != nil {
		return nil, fmt.Errorf("finding account: %w", err)
	}

	return account, nil
}

func (i *Service) IssueCard(accountID string) (*models.Card, error) {
    now := time.Now()
    // Determine years by configured product; callers can extend in future to pass per-card product.
    product := ""
    if i.cfg != nil {
        product = i.cfg.CardProduct
    }
    years := expiry.YearsForProduct(product, 0)
    // Store YYMM in DB; present MMYY to clients
    expYYMM := expiry.YYMM(now, years)
    expMMYY := expiry.MMYY(now, years)
    // Generate unique Luhn-valid PAN using configured BIN with repository-backed uniqueness.
    bin := "421234"
    if i.cfg != nil && i.cfg.BINPrefix != "" {
        bin = i.cfg.BINPrefix
    }
    // Ensure BIN is valid; fallback to default if misconfigured.
    if err := cardgen.ValidateBIN(bin); err != nil {
        bin = "421234"
    }
    exists := func(pan string) (bool, error) { return i.repo.ExistsCardNumber(pan) }
    pan, err := cardgen.GenerateUniquePAN(bin, 16, "", 10, exists)
    if err != nil {
        return nil, fmt.Errorf("generate unique pan: %w", err)
    }
    // Create card with uniqueness retry to avoid race on insert
    for attempt := 0; attempt < 5; attempt++ {
        card := &models.Card{
            ID:                    uuid.New().String(),
            AccountID:             accountID,
            Number:                pan,
            ExpirationDate:        expYYMM, // DB expects YYMM
            // CVV should be a random 3-digit value
            CardVerificationValue: generateRandomNumber(3),
        }
        err = i.repo.CreateCard(card)
        if err == nil {
            // For API response return MMYY
            card.ExpirationDate = expMMYY
            return card, nil
        }
        if errors.Is(err, ErrConflict) {
            // regenerate and try again
            var regenErr error
            pan, regenErr = cardgen.GenerateUniquePAN(bin, 16, "", 10, exists)
            if regenErr != nil {
                return nil, fmt.Errorf("regenerate unique pan: %w", regenErr)
            }
            continue
        }
        return nil, fmt.Errorf("creating card: %w", err)
    }
    return nil, fmt.Errorf("could not create unique card after retries")
}

// ListTransactions returns a list of transactions for the given account ID.
func (i *Service) ListTransactions(accountID string) ([]*models.Transaction, error) {
	transactions, err := i.repo.ListTransactions(accountID)
	if err != nil {
		return nil, fmt.Errorf("listing transactions: %w", err)
	}

	return transactions, nil
}

func (i *Service) AuthorizeRequest(req models.AuthorizationRequest) (models.AuthorizationResponse, error) {
    card, err := i.repo.FindCardForAuthorization(req.Card)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            return models.AuthorizationResponse{
                ApprovalCode: models.ApprovalCodeInvalidCard,
            }, nil
        }

        return models.AuthorizationResponse{}, fmt.Errorf("finding card: %w", err)
    }

    // DB-backed path: perform atomic hold via repository when available
    if i.repo.db != nil {
        authCode := generateAuthorizationCode()
        appr := models.ApprovalCodeApproved
        retAppr, retAuth, dup, err := i.repo.CreateAuthAndHold(card.AccountID, card.ID, req.Amount, req.Currency, appr, authCode, req.Merchant.Name, req.Merchant.MCC, req.STAN)
        if err != nil {
            if errors.Is(err, models.ErrInsufficientFunds) {
                return models.AuthorizationResponse{ApprovalCode: models.ApprovalCodeInsufficientFunds}, nil
            }
            return models.AuthorizationResponse{}, fmt.Errorf("auth hold: %w", err)
        }
        // Use returned codes when idempotency hit
        if dup {
            return models.AuthorizationResponse{AuthorizationCode: retAuth, ApprovalCode: retAppr}, nil
        }
        return models.AuthorizationResponse{AuthorizationCode: retAuth, ApprovalCode: retAppr}, nil
    }

    // In-memory path (tests): create transaction and hold on account model
    account, err := i.repo.GetAccount(card.AccountID)
    if err != nil {
        return models.AuthorizationResponse{}, fmt.Errorf("finding account: %w", err)
    }
    transaction := &models.Transaction{
        ID:        uuid.New().String(),
        AccountID: card.AccountID,
        CardID:    card.ID,
        Amount:    req.Amount,
        Currency:  req.Currency,
        Merchant:  req.Merchant,
    }
    if err := i.repo.CreateTransaction(transaction); err != nil {
        return models.AuthorizationResponse{}, fmt.Errorf("creating transaction: %w", err)
    }
    if err := account.Hold(req.Amount); err != nil {
        if !errors.Is(err, models.ErrInsufficientFunds) {
            return models.AuthorizationResponse{}, fmt.Errorf("holding funds: %w", err)
        }
        return models.AuthorizationResponse{ApprovalCode: models.ApprovalCodeInsufficientFunds}, nil
    }
    transaction.ApprovalCode = models.ApprovalCodeApproved
    transaction.AuthorizationCode = generateAuthorizationCode()
    transaction.Status = models.TransactionStatusAuthorized

	return models.AuthorizationResponse{
		AuthorizationCode: transaction.AuthorizationCode,
		ApprovalCode:      transaction.ApprovalCode,
	}, nil
}

// CaptureByStan finds auth by PAN+expiry and STAN, then captures amount.
func (i *Service) CaptureByStan(pan, expiry string, stan int, amount int64, currency string) error {
    if i.repo.db == nil { return fmt.Errorf("not supported in memory repo") }
    // find card by PAN+expiry (DB uses pan_hash only, CVV ignored)
    card, err := i.repo.FindCardForAuthorization(models.Card{Number: pan, ExpirationDate: expiry})
    if err != nil { return err }
    authID, _, _, status, err := i.repo.FindAuthByCardStan(context.Background(), card.ID, stan)
    if err != nil { return err }
    if status != "AUTHORIZED" { return fmt.Errorf("bad auth status: %s", status) }
    return i.repo.CaptureAuth(context.Background(), authID, amount, currency)
}

// ReverseByStan reverses an authorized hold by PAN+expiry and STAN.
func (i *Service) ReverseByStan(pan, expiry string, stan int) error {
    if i.repo.db == nil { return fmt.Errorf("not supported in memory repo") }
    card, err := i.repo.FindCardForAuthorization(models.Card{Number: pan, ExpirationDate: expiry})
    if err != nil { return err }
    authID, _, _, status, err := i.repo.FindAuthByCardStan(context.Background(), card.ID, stan)
    if err != nil { return err }
    if status != "AUTHORIZED" { return fmt.Errorf("bad auth status: %s", status) }
    return i.repo.ReverseAuth(context.Background(), authID)
}

// SetCardholderName sets user-provided cardholder name on a card (in-memory repo only for now).
func (i *Service) SetCardholderName(accountID, cardID, name string) (*models.Card, error) {
    updated, err := i.repo.UpdateCardholderName(accountID, cardID, name)
    if err != nil {
        return nil, err
    }
    return updated, nil
}

// generateFakeCardNumber generates a fake card number starting with 9
// and a random 15-digit number. This is not a valid card number.
// Deprecated: generateFakeCardNumber retained for compatibility; PAN now generated via cardgen.
func generateFakeCardNumber() string { return fmt.Sprintf("9%s", generateRandomNumber(15)) }

func generateAuthorizationCode() string {
	return generateRandomNumber(6)
}

func generateRandomNumber(length int) string {
	rand.Seed(time.Now().UnixNano())

	// Generate a 6-digit random number
	randomDigits := make([]int, length)
	for i := 0; i < len(randomDigits); i++ {
		randomDigits[i] = rand.Intn(10)
	}

	var number string
	for _, digit := range randomDigits {
		number += fmt.Sprintf("%d", digit)
	}

	return number
}

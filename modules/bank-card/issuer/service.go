package issuer

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "strings"
    "time"

    "github.com/alovak/cardflow-playground/internal/cardgen"
    "github.com/alovak/cardflow-playground/internal/expiry"
    "github.com/alovak/cardflow-playground/issuer/corebank"
    "github.com/alovak/cardflow-playground/issuer/models"
    "github.com/google/uuid"
)

type Service struct {
    repo *Repository
    cfg  *Config
    core *corebank.Client
}

func NewService(repo *Repository, cfg *Config) *Service {
    var cb *corebank.Client
    if cfg != nil && cfg.CoreBankBaseURL != "" {
        cb = corebank.NewClient(cfg.CoreBankBaseURL, cfg.CoreBankAuthToken, cfg.CoreBankTenantID, cfg.coreBankTimeout())
    }
    return &Service{
        repo: repo,
        cfg:  cfg,
        core: cb,
    }
}

func (i *Service) CreateAccount(req models.CreateAccount) (*models.Account, error) {
	account := &models.Account{
		ID:               uuid.New().String(),
        CoreAccountID:    req.CoreAccountID,
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
            // CVV is 3-digit per requirement
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

// IssueCardFromCore fetches a core savings account, validates it, and issues a card bound to it.
func (i *Service) IssueCardFromCore(ctx context.Context, req models.IssueCardFromCoreRequest) (*models.IssueCardFromCoreResponse, error) {
    if i.core == nil {
        return nil, fmt.Errorf("core bank client not configured")
    }
    if req.RequestID == "" {
        return nil, fmt.Errorf("request_id is required")
    }
    if req.CoreAccountID == "" {
        return nil, fmt.Errorf("core_account_id is required and must be corebank internal ID")
    }
    // Idempotency: request_id first
    if link, err := i.repo.FindLinkByRequest(ctx, req.RequestID); err == nil {
        return i.buildResponseFromLink(ctx, link)
    } else if err != nil && !errors.Is(err, ErrNotFound) {
        return nil, err
    }

    coreID := req.CoreAccountID
    // Idempotency by core account id
    if link, err := i.repo.FindLinkByCore(ctx, coreID); err == nil {
        return i.buildResponseFromLink(ctx, link)
    } else if err != nil && !errors.Is(err, ErrNotFound) {
        return nil, err
    }

    coreAcct, err := i.core.GetSavingsAccount(ctx, coreID, req.ExternalID)
    if err != nil {
        return nil, fmt.Errorf("fetch core savings account: %w", err)
    }
    if !coreAcct.Status.Active {
        return nil, fmt.Errorf("CORE_ACCOUNT_NOT_ACTIVE:%s", coreAcct.Status.Code)
    }
    forbidden := i.cfg.forbiddenSubStatusSet()
    subCode := strings.ToUpper(coreAcct.SubStatus.Code)
    if _, blocked := forbidden[subCode]; blocked {
        return nil, fmt.Errorf("CORE_ACCOUNT_BLOCKED:%s", coreAcct.SubStatus.Code)
    }
    actDateStr, actDate := toDate(coreAcct.Timeline.ActivatedOnDate)
    if actDateStr == "" {
        return nil, fmt.Errorf("CORE_ACCOUNT_NOT_ACTIVATED")
    }

    customerID := coreAcct.ClientID
    if req.CustomerID != 0 && customerID != 0 && req.CustomerID != customerID {
        return nil, fmt.Errorf("customer_id mismatch core=%d request=%d", customerID, req.CustomerID)
    }
    if customerID == 0 {
        customerID = req.CustomerID
    }
    currency := coreAcct.Currency.Code
    if currency == "" && i.cfg != nil {
        currency = i.cfg.DefaultCurrency()
    }
    if currency == "" {
        currency = "USD"
    }
    currency = strings.ToUpper(currency)

    account, err := i.repo.GetAccountByCoreID(coreID)
    if err != nil && !errors.Is(err, ErrNotFound) {
        return nil, err
    }
    if account == nil {
        account = &models.Account{
            ID:            uuid.New().String(),
            CoreAccountID: coreID,
            Currency:      currency,
        }
        if err := i.repo.CreateAccount(account); err != nil {
            return nil, fmt.Errorf("creating issuer account: %w", err)
        }
    }

    card, err := i.IssueCard(account.ID)
    if err != nil {
        return nil, err
    }

    now := time.Now().UTC()
    link := &models.CardAccountLink{
        CardID:        card.ID,
        CoreAccountID: coreID,
        AccountNo:     coreAcct.AccountNo,
        ExternalID:    coreAcct.ExternalID,
        CustomerID:    customerID,
        ProductID:     coreAcct.SavingsProductID,
        CurrencyCode:  currency,
        ActivatedOn:   actDate,
        CoreStatus:    coreAcct.Status.Code,
        CoreSubStatus: coreAcct.SubStatus.Code,
        LinkStatus:    "BOUND",
        RequestID:     req.RequestID,
        LastCoreSyncAt: &now,
        LastCoreSyncResult: "OK",
    }
    if err := i.repo.CreateCardAccountLink(ctx, link); err != nil {
        if errors.Is(err, ErrConflict) {
            if existing, findErr := i.repo.FindLinkByCore(ctx, coreID); findErr == nil {
                return i.buildResponseFromLink(ctx, existing)
            }
        }
        return nil, fmt.Errorf("persist mapping: %w", err)
    }

    face := formatCardFace(card.ExpirationDate, card.CardholderName)
    return &models.IssueCardFromCoreResponse{
        CardID:        card.ID,
        CardFace:      face,
        CoreAccountID: coreID,
        AccountNo:     coreAcct.AccountNo,
        ExternalID:    coreAcct.ExternalID,
        CustomerID:    customerID,
        ProductID:     coreAcct.SavingsProductID,
        CurrencyCode:  currency,
        ActivatedOn:   actDateStr,
        CoreStatus:    coreAcct.Status.Code,
        CoreSubStatus: coreAcct.SubStatus.Code,
        LinkStatus:    link.LinkStatus,
        LastCoreSyncAt: now.Format(time.RFC3339),
        LastCoreSyncResult: link.LastCoreSyncResult,
        RequestID:     req.RequestID,
    }, nil
}

func (i *Service) buildResponseFromLink(ctx context.Context, link *models.CardAccountLink) (*models.IssueCardFromCoreResponse, error) {
    card, err := i.repo.GetCard(link.CardID)
    if err != nil {
        return nil, fmt.Errorf("load card for mapping: %w", err)
    }
    face := formatCardFace(card.ExpirationDate, card.CardholderName)
    activated := ""
    if link.ActivatedOn != nil {
        activated = link.ActivatedOn.Format("2006-01-02")
    }
    lastSync := ""
    if link.LastCoreSyncAt != nil {
        lastSync = link.LastCoreSyncAt.Format(time.RFC3339)
    }
    return &models.IssueCardFromCoreResponse{
        CardID:        link.CardID,
        CardFace:      face,
        CoreAccountID: link.CoreAccountID,
        AccountNo:     link.AccountNo,
        ExternalID:    link.ExternalID,
        CustomerID:    link.CustomerID,
        ProductID:     link.ProductID,
        CurrencyCode:  link.CurrencyCode,
        ActivatedOn:   activated,
        CoreStatus:    link.CoreStatus,
        CoreSubStatus: link.CoreSubStatus,
        LinkStatus:    link.LinkStatus,
        LastCoreSyncAt: lastSync,
        LastCoreSyncResult: link.LastCoreSyncResult,
        RequestID:     link.RequestID,
    }, nil
}

func toDate(parts []int) (string, *time.Time) {
    if len(parts) >= 3 && parts[0] > 0 && parts[1] > 0 && parts[2] > 0 {
        t := time.Date(parts[0], time.Month(parts[1]), parts[2], 0, 0, 0, 0, time.UTC)
        return t.Format("2006-01-02"), &t
    }
    return "", nil
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

package issuer

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "strings"
    "sync"

    "github.com/alovak/cardflow-playground/internal/cardgen"
    "github.com/alovak/cardflow-playground/issuer/models"
    "github.com/jackc/pgconn"
    "github.com/lib/pq"
)

var ErrNotFound = fmt.Errorf("not found")

type Repository struct {
    Cards        []*models.Card
    Accounts     []*models.Account
    Transactions []*models.Transaction

    mu sync.RWMutex
    panIndex map[string]struct{}
    db      *sql.DB
    hashKey []byte
}

func NewRepository() *Repository {
    return &Repository{
        Cards:        make([]*models.Card, 0),
        Accounts:     make([]*models.Account, 0),
        Transactions: make([]*models.Transaction, 0),
        panIndex:     make(map[string]struct{}),
    }
}

// NewPGRepository constructs a db-backed repository.
func NewPGRepository(db *sql.DB, hashKey []byte) *Repository {
    return &Repository{db: db, hashKey: hashKey}
}

func (r *Repository) CreateAccount(account *models.Account) error {
    if r.db == nil {
        r.mu.Lock()
        defer r.mu.Unlock()
        r.Accounts = append(r.Accounts, account)
        return nil
    }
    _, err := r.db.ExecContext(context.Background(), `
        INSERT INTO issuer.accounts(account_id, core_account_id, currency, available_balance, hold_balance)
        VALUES ($1,$2,$3,$4,$5)
    `, account.ID, account.ID, strings.ToUpper(account.Currency), account.AvailableBalance, account.HoldBalance)
    return err
}

func (r *Repository) GetAccount(accountID string) (*models.Account, error) {
    if r.db == nil {
        r.mu.RLock()
        defer r.mu.RUnlock()
        for _, account := range r.Accounts {
            if account.ID == accountID {
                return account, nil
            }
        }
        return nil, ErrNotFound
    }
    row := r.db.QueryRowContext(context.Background(), `SELECT account_id, currency, available_balance, hold_balance FROM issuer.accounts WHERE account_id=$1`, accountID)
    var id, cur string
    var avail, hold int64
    if err := row.Scan(&id, &cur, &avail, &hold); err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrNotFound
        }
        return nil, err
    }
    return &models.Account{ID: id, Currency: cur, AvailableBalance: avail, HoldBalance: hold}, nil
}

var ErrConflict = fmt.Errorf("conflict")

func (r *Repository) CreateCard(card *models.Card) error {
    if r.db == nil {
        r.mu.Lock()
        defer r.mu.Unlock()
        if _, ok := r.panIndex[card.Number]; ok {
            return fmt.Errorf("card number exists: %w", ErrConflict)
        }
        r.Cards = append(r.Cards, card)
        r.panIndex[card.Number] = struct{}{}
        return nil
    }
    panNorm := cardgen.NormalizePAN(card.Number)
    bin := panNorm
    if len(bin) > 9 { bin = bin[:9] }
    if len(bin) >= 6 { bin = bin[:len(bin)] } // keep up to 9; ensure not empty
    last4 := cardgen.LastN(panNorm, 4)
    hash := cardgen.HashPANHMAC(panNorm, r.hashKey)
    _, err := r.db.ExecContext(context.Background(), `
        INSERT INTO issuer.cards(card_id, account_id, bin, last4, expiry_yymm, status, pan_hash)
        VALUES ($1,$2,$3,$4,$5,'ISSUED',$6)
    `, card.ID, card.AccountID, bin, last4, card.ExpirationDate, hash)
    if isUniqueViolation(err) {
        return ErrConflict
    }
    return err
}

// UpdateCardholderName updates the in-memory cardholder name for a card and returns the updated card.
// For DB-backed repository this operation is not yet supported.
func (r *Repository) UpdateCardholderName(accountID, cardID, name string) (*models.Card, error) {
    if r.db != nil {
        return nil, fmt.Errorf("updating cardholder name is not supported in DB mode")
    }
    r.mu.Lock()
    defer r.mu.Unlock()
    for _, c := range r.Cards {
        if c.ID == cardID && c.AccountID == accountID {
            c.CardholderName = name
            return c, nil
        }
    }
    return nil, ErrNotFound
}

// ExistsCardNumber reports whether a PAN already exists.
func (r *Repository) ExistsCardNumber(pan string) (bool, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    _, ok := r.panIndex[pan]
    return ok, nil
}

func (r *Repository) FindCardForAuthorization(card models.Card) (*models.Card, error) {
    if r.db == nil {
        r.mu.RLock()
        defer r.mu.RUnlock()
        for _, c := range r.Cards {
            match := c.Number == card.Number && c.ExpirationDate == card.ExpirationDate && c.CardVerificationValue == card.CardVerificationValue
            if match { return c, nil }
        }
        return nil, ErrNotFound
    }
    hash := cardgen.HashPANHMAC(cardgen.NormalizePAN(card.Number), r.hashKey)
    row := r.db.QueryRowContext(context.Background(), `SELECT card_id, account_id, last4, expiry_yymm FROM issuer.cards WHERE pan_hash=$1 AND expiry_yymm=$2`, hash, card.ExpirationDate)
    var id, acc, last4, exp string
    if err := row.Scan(&id, &acc, &last4, &exp); err != nil {
        if errors.Is(err, sql.ErrNoRows) { return nil, ErrNotFound }
        return nil, err
    }
    return &models.Card{ID: id, AccountID: acc, Number: "****"+last4, ExpirationDate: exp}, nil
}

func (r *Repository) CreateTransaction(transaction *models.Transaction) error {
    if r.db == nil {
        r.mu.Lock(); defer r.mu.Unlock()
        r.Transactions = append(r.Transactions, transaction)
        return nil
    }
    _, err := r.db.ExecContext(context.Background(), `
        INSERT INTO issuer.transactions(tx_id, account_id, card_id, amount, currency, status, authorization_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, transaction.ID, transaction.AccountID, transaction.CardID, transaction.Amount, transaction.Currency, string(transaction.Status), transaction.AuthorizationCode)
    return err
}

// ListTransactions returns all transactions for a given account ID.
func (r *Repository) ListTransactions(accountID string) ([]*models.Transaction, error) {
    if r.db == nil {
        r.mu.RLock(); defer r.mu.RUnlock()
        var transactions []*models.Transaction
        for _, t := range r.Transactions {
            if t.AccountID == accountID { transactions = append(transactions, t) }
        }
        return transactions, nil
    }
    rows, err := r.db.QueryContext(context.Background(), `SELECT tx_id, account_id, card_id, amount, currency, status, authorization_code FROM issuer.transactions WHERE account_id=$1 ORDER BY created_at DESC`, accountID)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []*models.Transaction
    for rows.Next() {
        var t models.Transaction; var status string
        if err := rows.Scan(&t.ID, &t.AccountID, &t.CardID, &t.Amount, &t.Currency, &status, &t.AuthorizationCode); err != nil { return nil, err }
        t.Status = models.TransactionStatus(status)
        out = append(out, &t)
    }
    return out, rows.Err()
}

// CreateAuthAndHold performs atomic authorization in DB backend.
// Returns (approvalCode, authorizationCode, dup, error). When dup is true, codes originate from existing auth.
func (r *Repository) CreateAuthAndHold(accountID, cardID string, amount int64, currency, approvalCode, authorizationCode, merchantName, mcc string, stan *int) (string, string, bool, error) {
    if r.db == nil {
        // Memory repo path (tests): simulate success, no idempotency
        return approvalCode, authorizationCode, false, nil
    }
    tx, err := r.db.BeginTx(context.Background(), nil)
    if err != nil { return "", "", false, err }
    defer tx.Rollback()
    // set per-transaction statement timeout to avoid long hangs
    if _, err := tx.ExecContext(context.Background(), `set local statement_timeout = '3s'`); err != nil { return "", "", false, err }

    // If STAN is provided, try insert-first with ON CONFLICT DO NOTHING
    if stan != nil {
        var insertedID string
        // Try insert authorized auth; if conflict, SELECT existing
        row := tx.QueryRowContext(context.Background(), `
          insert into issuer.auths(auth_id, account_id, card_id, amount, currency, status,
                                   approval_code, authorization_code, merchant_name, mcc, stan)
          values(gen_random_uuid(), $1,$2,$3,$4,'AUTHORIZED',$5,$6,$7,$8,$9)
          on conflict (card_id, stan) where stan is not null do nothing
          returning auth_id
        `, accountID, cardID, amount, strings.ToUpper(currency), approvalCode, authorizationCode, merchantName, mcc, *stan)
        _ = row.Scan(&insertedID)
        if insertedID == "" {
            // duplicate: fetch existing and validate semantics
            var existedAmount int64
            var existedCurr, existedAppr, existedAuth string
            if err := tx.QueryRowContext(context.Background(), `
                select amount, currency, approval_code, authorization_code from issuer.auths where card_id=$1 and stan=$2
            `, cardID, *stan).Scan(&existedAmount, &existedCurr, &existedAppr, &existedAuth); err != nil {
                return "", "", false, err
            }
            if existedAmount != amount || strings.ToUpper(existedCurr) != strings.ToUpper(currency) {
                return "", "", false, fmt.Errorf("%w", models.ErrInsufficientFunds) // semantic mismatch; could be dedicated error
            }
            if err := tx.Commit(); err != nil { return "", "", false, err }
            return existedAppr, existedAuth, true, nil
        }
        // On fresh insert with STAN, proceed to adjust balances
    }

    res, err := tx.ExecContext(context.Background(), `
        UPDATE issuer.accounts
           SET available_balance = available_balance - $2,
               hold_balance      = hold_balance      + $2,
               updated_at        = now()
         WHERE account_id=$1 AND available_balance >= $2
    `, accountID, amount)
    if err != nil { return "", "", false, err }
    if rows, _ := res.RowsAffected(); rows == 0 {
        return "", "", false, models.ErrInsufficientFunds
    }
    if stan == nil {
        _, err = tx.ExecContext(context.Background(), `
            INSERT INTO issuer.auths(auth_id, account_id, card_id, amount, currency, status, approval_code, authorization_code, merchant_name, mcc)
            VALUES (gen_random_uuid(), $1,$2,$3,$4,'AUTHORIZED',$5,$6,$7,$8)
        `, accountID, cardID, amount, strings.ToUpper(currency), approvalCode, authorizationCode, merchantName, mcc)
        if err != nil { return "", "", false, err }
    }
    if err := tx.Commit(); err != nil { return "", "", false, err }
    return approvalCode, authorizationCode, false, nil
}

// CaptureAuth moves funds from hold to transactions; minimal full capture path.
func (r *Repository) CaptureAuth(ctx context.Context, authID string, amount int64, currency string) error {
    if r.db == nil { return fmt.Errorf("not supported in memory repo") }
    tx, err := r.db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()
    if _, err := tx.ExecContext(ctx, "set local statement_timeout = '3s'"); err != nil { return err }

    var accountID, cardID, curr, status string
    var authAmount int64
    err = tx.QueryRowContext(ctx, `
      select account_id, card_id, amount, currency, status from issuer.auths where auth_id=$1 for update
    `, authID).Scan(&accountID, &cardID, &authAmount, &curr, &status)
    if err == sql.ErrNoRows { return fmt.Errorf("auth not found") }
    if err != nil { return err }
    if status != "AUTHORIZED" { return fmt.Errorf("bad auth status: %s", status) }
    if strings.ToUpper(curr) != strings.ToUpper(currency) { return fmt.Errorf("currency mismatch") }
    if amount <= 0 { amount = authAmount }
    if amount > authAmount { return fmt.Errorf("invalid capture amount") }

    if _, err := tx.ExecContext(ctx, `
      update issuer.accounts set hold_balance = hold_balance - $2, updated_at=now() where account_id=$1
    `, accountID, amount); err != nil { return err }

    if _, err := tx.ExecContext(ctx, `
      insert into issuer.transactions(tx_id, account_id, card_id, auth_id, amount, currency, status, posted_at)
      values (gen_random_uuid(), $1,$2,$3,$4,$5,'CAPTURED', now())
    `, accountID, cardID, authID, amount, strings.ToUpper(currency)); err != nil { return err }

    newStatus := "CAPTURED"
    if amount < authAmount { newStatus = "AUTHORIZED" }
    if _, err := tx.ExecContext(ctx, `update issuer.auths set status=$2 where auth_id=$1`, authID, newStatus); err != nil { return err }
    return tx.Commit()
}

// ReleaseExpiredHolds releases expired authorized holds in batches, returns count released.
func (r *Repository) ReleaseExpiredHolds(ctx context.Context, batch int) (int, error) {
    if r.db == nil { return 0, fmt.Errorf("not supported in memory repo") }
    tx, err := r.db.BeginTx(ctx, nil)
    if err != nil { return 0, err }
    defer tx.Rollback()
    if _, err := tx.ExecContext(ctx, "set local statement_timeout = '5s'"); err != nil { return 0, err }
    rows, err := tx.QueryContext(ctx, `
      select auth_id, account_id, amount from issuer.auths
       where status='AUTHORIZED' and hold_expires_at <= now()
       order by hold_expires_at asc
       limit $1 for update skip locked
    `, batch)
    if err != nil { return 0, err }
    defer rows.Close()
    type item struct{ AuthID, AccountID string; Amount int64 }
    var list []item
    for rows.Next() {
        var it item
        if err := rows.Scan(&it.AuthID, &it.AccountID, &it.Amount); err != nil { return 0, err }
        list = append(list, it)
    }
    if err := rows.Err(); err != nil { return 0, err }
    if len(list) == 0 { _ = tx.Commit(); return 0, nil }
    agg := map[string]int64{}
    for _, it := range list { agg[it.AccountID] += it.Amount }
    for acc, sum := range agg {
        if _, err := tx.ExecContext(ctx, `update issuer.accounts set hold_balance = hold_balance - $2, updated_at=now() where account_id=$1`, acc, sum); err != nil { return 0, err }
    }
    // mark auths reversed
    for _, it := range list {
        if _, err := tx.ExecContext(ctx, `update issuer.auths set status='REVERSED' where auth_id=$1`, it.AuthID); err != nil { return 0, err }
    }
    if err := tx.Commit(); err != nil { return 0, err }
    return len(list), nil
}

// ReverseAuth reverses a single authorized hold (manual release for one auth).
func (r *Repository) ReverseAuth(ctx context.Context, authID string) error {
    if r.db == nil { return fmt.Errorf("not supported in memory repo") }
    tx, err := r.db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()
    if _, err := tx.ExecContext(ctx, "set local statement_timeout = '3s'"); err != nil { return err }
    var accountID string
    var amount int64
    var status string
    if err := tx.QueryRowContext(ctx, `select account_id, amount, status from issuer.auths where auth_id=$1 for update`, authID).Scan(&accountID, &amount, &status); err != nil {
        return err
    }
    if status != "AUTHORIZED" { return fmt.Errorf("bad auth status: %s", status) }
    if _, err := tx.ExecContext(ctx, `update issuer.accounts set hold_balance = hold_balance - $2, updated_at=now() where account_id=$1`, accountID, amount); err != nil { return err }
    if _, err := tx.ExecContext(ctx, `update issuer.auths set status='REVERSED' where auth_id=$1`, authID); err != nil { return err }
    return tx.Commit()
}

// FindAuthByCardStan returns auth id and details for (card_id, stan).
func (r *Repository) FindAuthByCardStan(ctx context.Context, cardID string, stan int) (authID string, amount int64, currency string, status string, err error) {
    if r.db == nil { return "", 0, "", "", fmt.Errorf("not supported in memory repo") }
    err = r.db.QueryRowContext(ctx, `select auth_id, amount, currency, status from issuer.auths where card_id=$1 and stan=$2`, cardID, stan).Scan(&authID, &amount, &currency, &status)
    return
}

// Ping returns DB readiness
func (r *Repository) Ping(ctx context.Context) error {
    if r.db == nil { return nil }
    return r.db.PingContext(ctx)
}

func isUniqueViolation(err error) bool {
    var pe *pq.Error
    if errors.As(err, &pe) && pe.Code == "23505" { return true }
    var pgerr *pgconn.PgError
    if errors.As(err, &pgerr) && pgerr.Code == "23505" { return true }
    return false
}

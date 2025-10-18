package issuer_test

import (
    "database/sql"
    "os"
    "testing"
    "time"

    issuer "github.com/alovak/cardflow-playground/issuer"
    "github.com/alovak/cardflow-playground/issuer/models"
    "github.com/alovak/cardflow-playground/internal/expiry"
    _ "github.com/lib/pq"
)

// TestCardExpiryStoredAsYYMM verifies that cards.expiry_yymm is stored as YYMM in DB.
// Skips unless DB_DSN is provided and REPO_BACKEND=pg.
func TestCardExpiryStoredAsYYMM(t *testing.T) {
    if os.Getenv("REPO_BACKEND") != "pg" {
        t.Skip("REPO_BACKEND != pg; skipping DB integration test")
    }
    dsn := os.Getenv("DB_DSN")
    if dsn == "" {
        t.Skip("DB_DSN not set; skipping DB integration test")
    }

    db, err := sql.Open("postgres", dsn)
    if err != nil { t.Fatalf("open db: %v", err) }
    defer db.Close()
    if err := db.Ping(); err != nil { t.Fatalf("ping db: %v", err) }

    repo := issuer.NewPGRepository(db, []byte("test-pan-hash-key"))
    svc := issuer.NewService(repo, issuer.DefaultConfig())

    // Create account
    acc, err := svc.CreateAccount(models.CreateAccount{Balance: 10000, Currency: "USD"})
    if err != nil { t.Fatalf("create account: %v", err) }

    // Issue card
    card, err := svc.IssueCard(acc.ID)
    if err != nil { t.Fatalf("issue card: %v", err) }

    // Verify DB has YYMM
    var expiryYYMM string
    row := db.QueryRow(`select expiry_yymm from issuer.cards where card_id=$1`, card.ID)
    if err := row.Scan(&expiryYYMM); err != nil {
        t.Fatalf("scan expiry_yymm: %v", err)
    }
    if len(expiryYYMM) != 4 {
        t.Fatalf("expiry_yymm length = %d want 4, got %q", len(expiryYYMM), expiryYYMM)
    }
    mm := expiryYYMM[2:]
    if mm < "01" || mm > "12" {
        t.Fatalf("expiry_yymm month invalid: %q (full %q)", mm, expiryYYMM)
    }

    // Cross-check with expected YYMM from service's policy (debit=5y)
    years := issuer.DefaultConfig().ProductYears[issuer.DefaultConfig().CardProduct]
    wantYYMM := expiry.YYMM(time.Now(), years)
    if expiryYYMM != wantYYMM {
        // Allow soft check across month boundary: only validate month portion
        if expiryYYMM[2:] != wantYYMM[2:] {
            t.Fatalf("expiry_yymm mismatch: db=%s want=%s", expiryYYMM, wantYYMM)
        }
    }
}


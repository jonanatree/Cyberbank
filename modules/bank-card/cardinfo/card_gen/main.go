//go:build demo

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/alovak/cardflow-playground/internal/cardgen"
	"github.com/alovak/cardflow-playground/internal/expiry"
	"github.com/alovak/cardflow-playground/internal/issuerdev"
	"github.com/alovak/cardflow-playground/internal/security"
)

var (
    flagBIN       = flag.String("bin", "421234", "6/8/9-digit BIN prefix")
    flagAccountID = flag.String("account", "", "issuer account ID (UUID)")
    flagIssuer    = flag.String("issuer", "http://127.0.0.1:8080", "issuer base URL")
    flagYears     = flag.Int("years", 0, "override validity years (if > 0)")
    flagProduct   = flag.String("product", "debit", "card product: credit|debit (defaults to debit)")
	flagShowOnly  = flag.Bool("print", false, "print JSON only, do not POST")
	flagSequence  = flag.String("sequence", "", "optional numeric sequence (before check digit)")
	flagShowCVV   = flag.Bool("show-cvv", false, "print CVV to console (DANGEROUS; for demo only)")
	flagVerbose   = flag.Bool("verbose", false, "print full PAN (otherwise masked)")
	flagDCVVStep  = flag.Int("dcvv-step", 30, "display CVV step seconds (UI-only, default 30s)")
	flagCardName  = flag.String("card-name", "", "cardholder name for card face imprint")
)

func main() {
	flag.Parse()
	must(cardgen.ValidateBIN(*flagBIN))
	if *flagAccountID == "" {
		fail("-account is required (issuer account UUID)")
	}
	if *flagDCVVStep <= 0 {
		fail("-dcvv-step must be positive seconds")
	}

	cardName := normalizeCardName(*flagCardName)
	pan := must1(cardgen.GeneratePAN(*flagBIN, *flagSequence))
	now := time.Now()
	years := expiry.YearsForProduct(*flagProduct, *flagYears)

	expCardFace := expiry.CardFace(now, years)
	expYYMM := expiry.YYMM(now, years)

    // 使用统一 Provider（严格 Demo 版）
    key := must1(security.StrictDemoKey())
    defer security.Wipe(key)
    provider := security.NewDemoProviderStrict(key)
    panNoCD := pan[:len(pan)-1]
    staticCVV := must1(provider.ComputeCVV2(panNoCD, expYYMM, "101", 3))
    dcvv, ttlSec, err := provider.ComputeDisplayDCVV(panNoCD, expYYMM, "101", time.Duration(*flagDCVVStep)*time.Second, 3)
    must(err)

	printPAN := cardgen.MaskPAN(pan)
	if *flagVerbose {
		printPAN = pan + "   (WARNING: printing full PAN)"
	}

    fmt.Printf("PAN: %s\nEXP(card-face): %s  EXP(api): %s\n", printPAN, expCardFace, expYYMM)
	if cardName != "" {
		fmt.Printf("NAME(card-face): %s\n", cardName)
	} else {
		fmt.Println("NAME(card-face): (provide --card-name to imprint)")
	}
    if *flagShowCVV {
        fmt.Printf("CVV(static, one-time): %s\n", staticCVV)
    }
    fmt.Printf("CVV(dynamic, UI-only): %s (expires in %ds)\n", dcvv, ttlSec)

	req := issuerdev.IssueReq{
		PAN:            pan,
		ExpiryYYMM:     expYYMM,
		CardholderName: cardName,
		Description:    "issued by script",
	}

	if *flagShowOnly {
		enc, _ := json.MarshalIndent(req, "", "  ")
		fmt.Println(string(enc))
		return
	}

	cli := issuerdev.New(strings.TrimRight(*flagIssuer, "/"), &http.Client{Timeout: 10 * time.Second})
	ctx := context.Background()
	must(cli.EnsurePANUnique(ctx, pan))
	must(cli.IssueExternal(ctx, *flagAccountID, req))
	fmt.Println("Issued via issuer dev endpoint OK.")
}

func normalizeCardName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	normalized := strings.Join(strings.Fields(trimmed), " ")
	up := strings.ToUpper(normalized)
	if len(up) > 26 {
		return up[:26]
	}
	return up
}

func must(err error) {
	if err != nil {
		fail("%v", err)
	}
}
func must1[T any](v T, err error) T {
	if err != nil {
		fail("%v", err)
	}
	return v
}
func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

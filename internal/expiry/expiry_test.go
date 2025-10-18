package expiry

import (
    "testing"
    "time"
)

func TestFormats_Rollover(t *testing.T) {
    issue := time.Date(2029, time.December, 15, 0, 0, 0, 0, time.UTC)
    years := 1
    if got := YYMM(issue, years); got != "3012" {
        t.Fatalf("YYMM got %s want %s", got, "3012")
    }
    if got := MMYY(issue, years); got != "1230" {
        t.Fatalf("MMYY got %s want %s", got, "1230")
    }
    if got := CardFace(issue, years); got != "12/30" {
        t.Fatalf("CardFace got %s want %s", got, "12/30")
    }
}

func TestFormats_LeapIssue(t *testing.T) {
    // Leap day issue should add years correctly.
    issue := time.Date(2028, time.February, 29, 0, 0, 0, 0, time.UTC)
    years := 3
    if got := YYMM(issue, years); got != "3102" {
        t.Fatalf("YYMM got %s want %s", got, "3102")
    }
    if got := MMYY(issue, years); got != "0231" {
        t.Fatalf("MMYY got %s want %s", got, "0231")
    }
    if got := CardFace(issue, years); got != "02/31" {
        t.Fatalf("CardFace got %s want %s", got, "02/31")
    }
}

func TestParseYYMMEndOfMonth(t *testing.T) {
    // 2030-02 (non-leap): expect 28th 23:59:59.999999999
    ts, err := ParseYYMMEndOfMonth("3002", time.UTC)
    if err != nil { t.Fatalf("err: %v", err) }
    want := time.Date(2030, time.February, 28, 23, 59, 59, 999999999, time.UTC)
    if !ts.Equal(want) {
        t.Fatalf("got %v want %v", ts, want)
    }

    // 2030-04: 30th 23:59:59.999999999
    ts, err = ParseYYMMEndOfMonth("3004", time.UTC)
    if err != nil { t.Fatalf("err: %v", err) }
    want = time.Date(2030, time.April, 30, 23, 59, 59, 999999999, time.UTC)
    if !ts.Equal(want) {
        t.Fatalf("got %v want %v", ts, want)
    }

    // 2029-02: 28th 23:59:59.999999999
    ts, err = ParseYYMMEndOfMonth("2902", time.UTC)
    if err != nil { t.Fatalf("err: %v", err) }
    want = time.Date(2029, time.February, 28, 23, 59, 59, 999999999, time.UTC)
    if !ts.Equal(want) {
        t.Fatalf("got %v want %v", ts, want)
    }
}

func TestValidateYYMM(t *testing.T) {
    cases := []struct{ in string; ok bool }{
        {"3002", true}, {"9912", true}, {"0001", true},
        {"123", false}, {"12a4", false}, {"3013", false}, {"0000", false},
    }
    for _, c := range cases {
        err := ValidateYYMM(c.in)
        if (err == nil) != c.ok {
            t.Fatalf("ValidateYYMM(%s) ok=%v got err=%v", c.in, c.ok, err)
        }
    }
}

func TestIsExpired(t *testing.T) {
    yymm := "3002" // 2030-02
    end, _ := ParseYYMMEndOfMonth(yymm, time.UTC)
    // Just before end (1ns before) -> not expired
    notYet := end.Add(-time.Nanosecond)
    expired, err := IsExpired(yymm, notYet, time.UTC)
    if err != nil || expired {
        t.Fatalf("expected not expired at %v, got expired=%v err=%v", notYet, expired, err)
    }
    // At end -> not expired (expiry is end instant inclusive)
    expired, err = IsExpired(yymm, end, time.UTC)
    if err != nil || expired {
        t.Fatalf("expected not expired at end, got expired=%v err=%v", expired, err)
    }
    // After end -> expired
    after := end.Add(time.Nanosecond)
    expired, err = IsExpired(yymm, after, time.UTC)
    if err != nil || !expired {
        t.Fatalf("expected expired after %v, got expired=%v err=%v", end, expired, err)
    }
}

func TestReissueDue(t *testing.T) {
    yymm := "3002" // 2030-02
    end, _ := ParseYYMMEndOfMonth(yymm, time.UTC)
    // Window: [end-30d, end]
    days := 30
    before := end.AddDate(0, 0, -days-1)
    due, err := ReissueDue(yymm, before, time.UTC, days)
    if err != nil || due {
        t.Fatalf("expected not due before window, got due=%v err=%v", due, err)
    }
    start := end.AddDate(0, 0, -days)
    due, err = ReissueDue(yymm, start, time.UTC, days)
    if err != nil || !due {
        t.Fatalf("expected due at window start, got due=%v err=%v", due, err)
    }
    atEnd := end
    due, err = ReissueDue(yymm, atEnd, time.UTC, days)
    if err != nil || !due {
        t.Fatalf("expected due at window end, got due=%v err=%v", due, err)
    }
    after := end.Add(time.Nanosecond)
    due, err = ReissueDue(yymm, after, time.UTC, days)
    if err != nil || due {
        t.Fatalf("expected not due after expiry, got due=%v err=%v", due, err)
    }
}

func TestParseCardFace(t *testing.T) {
    yymm, err := ParseCardFace("10/30")
    if err != nil || yymm != "3010" {
        t.Fatalf("ParseCardFace 10/30 got %s err=%v", yymm, err)
    }
    yymm, err = ParseCardFace("1030")
    if err != nil || yymm != "3010" {
        t.Fatalf("ParseCardFace 1030 got %s err=%v", yymm, err)
    }
    if _, err := ParseCardFace("13/30"); err == nil { t.Fatalf("expected error for 13/30") }
}

func TestYearsForProduct(t *testing.T) {
    if got := YearsForProduct("credit", 0); got != 3 {
        t.Fatalf("credit years got %d want %d", got, 3)
    }
    if got := YearsForProduct("debit", 0); got != 5 {
        t.Fatalf("debit years got %d want %d", got, 5)
    }
    if got := YearsForProduct("anything", 7); got != 7 {
        t.Fatalf("override years got %d want %d", got, 7)
    }
}

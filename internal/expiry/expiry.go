package expiry

import (
    "fmt"
    "strconv"
    "strings"
    "time"
)

var (
    defaultLoc    = time.UTC
    productYears  = map[string]int{"credit": 3, "debit": 5}
)

// SetDefaultExpiryLocation sets the default time location for expiry calculations (fallback UTC).
func SetDefaultExpiryLocation(loc *time.Location) {
    if loc != nil {
        defaultLoc = loc
    }
}

// SetProductYears replaces default product→years mapping used by YearsForProduct.
func SetProductYears(m map[string]int) {
    if m == nil {
        return
    }
    productYears = m
}

// YearsForProduct returns validity years for product unless override>0.
func YearsForProduct(product string, override int) int {
    if override > 0 {
        return override
    }
    if y, ok := productYears[strings.ToLower(product)]; ok {
        return y
    }
    // default fallback
    return 5
}

// YYMM returns expiry in YYMM for an issue date + years.
func YYMM(issue time.Time, years int) string {
    t := issue.In(defaultLoc)
    y := (t.Year() + years) % 100
    m := int(t.Month())
    return fmt.Sprintf("%02d%02d", y, m)
}

// MMYY returns expiry in MMYY for an issue date + years.
func MMYY(issue time.Time, years int) string {
    t := issue.In(defaultLoc)
    y := (t.Year() + years) % 100
    m := int(t.Month())
    return fmt.Sprintf("%02d%02d", m, y)
}

// CardFace returns expiry as MM/YY for card imprint.
func CardFace(issue time.Time, years int) string {
    t := issue.In(defaultLoc)
    y := (t.Year() + years) % 100
    m := int(t.Month())
    return fmt.Sprintf("%02d/%02d", m, y)
}

// ParseYYMMEndOfMonth parses YYMM into the last instant of that month in loc.
func ParseYYMMEndOfMonth(yymm string, loc *time.Location) (time.Time, error) {
    if err := ValidateYYMM(yymm); err != nil {
        return time.Time{}, err
    }
    if loc == nil {
        loc = defaultLoc
    }
    yy, _ := strconv.Atoi(yymm[:2])
    mm, _ := strconv.Atoi(yymm[2:])
    year := 2000 + yy
    // First day of next month
    firstNext := time.Date(year, time.Month(mm), 1, 0, 0, 0, 0, loc).AddDate(0, 1, 0)
    // End of target month = 1ns before first day of next month
    end := firstNext.Add(-time.Nanosecond)
    return end, nil
}

// IsExpired reports whether time 'at' is strictly after the end of YYMM month in loc.
func IsExpired(yymm string, at time.Time, loc *time.Location) (bool, error) {
    end, err := ParseYYMMEndOfMonth(yymm, loc)
    if err != nil {
        return false, err
    }
    return at.In(end.Location()).After(end), nil
}

// ReissueDue returns true if 'at' is within [end-windowDays, end] inclusive.
func ReissueDue(yymm string, at time.Time, loc *time.Location, windowDays int) (bool, error) {
    end, err := ParseYYMMEndOfMonth(yymm, loc)
    if err != nil {
        return false, err
    }
    start := end.AddDate(0, 0, -windowDays)
    at = at.In(end.Location())
    if (at.Equal(start) || at.After(start)) && (at.Before(end) || at.Equal(end)) {
        return true, nil
    }
    return false, nil
}

// ParseCardFace accepts "MM/YY" or "MMYY" and returns YYMM.
func ParseCardFace(in string) (string, error) {
    s := strings.TrimSpace(in)
    s = strings.ReplaceAll(s, "/", "")
    if len(s) != 4 {
        return "", fmt.Errorf("card face must be MM/YY or MMYY")
    }
    for i := 0; i < 4; i++ {
        if s[i] < '0' || s[i] > '9' {
            return "", fmt.Errorf("card face must be digits")
        }
    }
    mm, _ := strconv.Atoi(s[:2])
    if mm < 1 || mm > 12 {
        return "", fmt.Errorf("month must be 01..12")
    }
    yy := s[2:]
    return yy + fmt.Sprintf("%02d", mm), nil
}

// ValidateYYMM 校验到期格式为 YYMM，且月份在 01..12。
func ValidateYYMM(yymm string) error {
    if len(yymm) != 4 {
        return fmt.Errorf("expiry must be YYMM (4 digits)")
    }
    for i := 0; i < 4; i++ {
        if yymm[i] < '0' || yymm[i] > '9' {
            return fmt.Errorf("expiry must be digits: YYMM")
        }
    }
    mm := (int(yymm[2]-'0')*10 + int(yymm[3]-'0'))
    if mm < 1 || mm > 12 {
        return fmt.Errorf("expiry month must be 01..12")
    }
    return nil
}

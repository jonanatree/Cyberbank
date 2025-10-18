//go:build demo

package security

import (
    "fmt"
    "time"

    "github.com/alovak/cardflow-playground/internal/cardgen"
    "github.com/alovak/cardflow-playground/internal/expiry"
)

// DemoProvider：严格 Demo 实现（无 HSM），封装调用严格函数，保证输出一致。
// - 入参采用真实形状：panNoCD + YYMM + SC
// - width 仅支持 3 或 4
// - 时间统一使用 UTC 计算窗口与 TTL
type DemoProvider struct {
    key []byte
}

func NewDemoProviderStrict(key []byte) *DemoProvider { return &DemoProvider{key: key} }

// ComputeCVV2 计算静态 CVV（稳定、可复现）。
func (p *DemoProvider) ComputeCVV2(panNoCD, yymm, sc string, width int) (string, error) {
    if len(p.key) == 0 {
        return "", fmt.Errorf("cvv demo key is required")
    }
    if width != 4 { // 仅接受 3 或 4，其他回落到 3
        width = 3
    }
    if err := expiry.ValidateYYMM(yymm); err != nil {
        return "", err
    }
    if len(sc) != 3 || !cardgen.IsDigits(sc) {
        return "", fmt.Errorf("service code must be 3 digits")
    }
    if err := validatePanNoCD(panNoCD); err != nil {
        return "", err
    }
    pan := buildValidPAN(panNoCD)
    return StaticCVVDemoStrict(pan, yymm, sc, width, p.key)
}

// ComputeDisplayDCVV 计算用于展示的动态 CVV，返回 cvv 及剩余秒数。
func (p *DemoProvider) ComputeDisplayDCVV(panNoCD, yymm, sc string, step time.Duration, width int) (string, int, error) {
    if len(p.key) == 0 {
        return "", 0, fmt.Errorf("cvv demo key is required")
    }
    if step <= 0 {
        step = 30 * time.Second
    }
    if width != 4 { // 仅接受 3 或 4，其他回落到 3
        width = 3
    }
    if err := expiry.ValidateYYMM(yymm); err != nil {
        return "", 0, err
    }
    if len(sc) != 3 || !cardgen.IsDigits(sc) {
        return "", 0, fmt.Errorf("service code must be 3 digits")
    }
    if err := validatePanNoCD(panNoCD); err != nil {
        return "", 0, err
    }

    pan := buildValidPAN(panNoCD)
    // 统一归一化步长（至少1s、按秒对齐），并使用 UTC 时间
    step = normalizeStep(step)
    now := time.Now().UTC()
    cvv, ttl, err := DynamicCVVWithTTLStrict(pan, yymm, sc, now, step, width, p.key)
    if err != nil {
        return "", 0, err
    }
    return cvv, ttl, nil
}

// ValidateInputs：统一强校验工具（供 handler 使用）。
// 返回 pan 去校验位（panNoCD）。
func ValidateInputs(pan, yymm, sc string) (string, error) {
    if err := expiry.ValidateYYMM(yymm); err != nil {
        return "", err
    }
    if len(sc) != 3 || !cardgen.IsDigits(sc) {
        return "", fmt.Errorf("service code must be 3 digits")
    }
    pan = cardgen.NormalizePAN(pan)
    if err := cardgen.ValidatePAN(pan); err != nil {
        return "", err
    }
    return pan[:len(pan)-1], nil
}

// validatePanNoCD：校验 pan 去校验位为数字且长度 12..18。
func validatePanNoCD(noCD string) error {
    if noCD == "" || !cardgen.IsDigits(noCD) {
        return fmt.Errorf("panNoCD must be digits only")
    }
    if l := len(noCD); l < 12 || l > 18 {
        return fmt.Errorf("panNoCD length must be 12..18 (got %d)", l)
    }
    return nil
}

// buildValidPAN：根据 panNoCD 计算 Luhn 校验位并返回完整 PAN。
func buildValidPAN(noCD string) string {
    cd := luhnCheckDigit(noCD)
    return noCD + cd
}

// luhnCheckDigit：计算 Luhn 校验位（返回单字符字符串）。
func luhnCheckDigit(body string) string {
    sum, dbl := 0, true
    for i := len(body) - 1; i >= 0; i-- {
        d := int(body[i] - '0')
        if dbl {
            d *= 2
            if d > 9 {
                d -= 9
            }
        }
        sum += d
        dbl = !dbl
    }
    cd := (10 - (sum % 10)) % 10
    return string('0' + byte(cd))
}

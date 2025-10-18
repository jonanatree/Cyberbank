//go:build demo

package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/alovak/cardflow-playground/internal/cardgen"
	"github.com/alovak/cardflow-playground/internal/expiry"
)

// 注意：本文件为 Demo/离线联调用途，不可用于生产授权/清算/风控。
// 生产环境请使用 HSM Provider 实现真实 CVV。

// =================== 你的现有演示函数（保留，向后兼容） ===================

// DemoKey returns a demo CVK key loaded from environment or a static fallback (NOT SAFE FOR PROD).
func DemoKey() []byte {
	key := []byte(os.Getenv("CVK_DEMO"))
	if len(key) == 0 {
		key = []byte("demo-cvk-not-for-production")
	}
	return key
}

// StaticCVV computes a demo static CVV from PAN last-12 + expiry + label (UI only).
func StaticCVV(pan, expiry, label string, key []byte) string {
    panTail := cardgen.LastN(pan, 12)
    msg := []byte(panTail + "|" + expiry + "|" + label)
    return hmacTruncatedDecimal(key, msg, nil, 3)
}

// DynamicCVV computes a time-based demo CVV for UI display only, returns code + expiresAt.
func DynamicCVV(pan, expiry string, now time.Time, step time.Duration, key []byte) (string, time.Time) {
    step = normalizeStep(step)
    panTail := cardgen.LastN(pan, 12)
    msg := []byte(panTail + "|" + expiry + "|dynamic")

    window := now.Unix() / int64(step.Seconds())
    buf := make([]byte, 8)
    binary.BigEndian.PutUint64(buf, uint64(window))
    expiresAt := time.Unix((window+1)*int64(step.Seconds()), 0).UTC()
    return hmacTruncatedDecimal(key, msg, buf, 3), expiresAt
}

// =================== 贴近真实形状的 Strict 版本（新增） ===================

// StrictDemoKey: 强制从环境提供 demo key；缺失则报错（开发/离线必需；生产请换 HSM Provider）
var errKeyMissing = errors.New("CVK_DEMO not set; provide a demo key in dev (never use in prod)")

func StrictDemoKey() ([]byte, error) {
	key := []byte(os.Getenv("CVK_DEMO"))
	if len(key) == 0 {
		return nil, errKeyMissing
	}
	return key, nil
}

// 域分离常量（用途标识）
const (
	domainStatic  = "static-v1"
	domainDynamic = "dynamic-v1"
)

// 工具：规范 PAN → 校验 → 去校验位
func panNoCDStrict(pan string) (string, error) {
	p := cardgen.NormalizePAN(pan)
	if err := cardgen.ValidatePAN(p); err != nil {
		return "", err
	}
	return stripCheckDigit(p), nil
}

// 工具：步长规范化（至少 1s，按秒对齐）
func normalizeStep(step time.Duration) time.Duration {
    if step < time.Second {
        return time.Second
    }
    sec := step / time.Second
    return sec * time.Second
}

// 工具：宽度规范化，仅允许 3 或 4，其他回落到 3
func normalizeWidth(width int) int {
    if width == 4 {
        return 4
    }
    return 3
}

// 工具：基于 HMAC-SHA256 的动态截断并格式化为 3/4 位十进制。
// msg 为基础消息，extra 为可选附加（例如时间窗口字节）。
func hmacTruncatedDecimal(key, msg, extra []byte, width int) string {
    h := hmac.New(sha256.New, key)
    h.Write(msg)
    if len(extra) > 0 {
        h.Write(extra)
    }
    sum := h.Sum(nil)
    off := sum[len(sum)-1] & 0x0f
    code := (uint32(sum[off])&0x7f)<<24 |
        (uint32(sum[off+1])&0xff)<<16 |
        (uint32(sum[off+2])&0xff)<<8 |
        (uint32(sum[off+3]) & 0xff)
    width = normalizeWidth(width)
    if width == 4 {
        return fmt.Sprintf("%04d", code%10000)
    }
    return fmt.Sprintf("%03d", code%1000)
}

// 校验 service code（3位数字，如 "101"/"000"）
func validateServiceCode(sc string) error {
	if len(sc) != 3 {
		return fmt.Errorf("serviceCode must be 3 digits (got len=%d)", len(sc))
	}
	if !cardgen.IsDigits(sc) {
		return fmt.Errorf("serviceCode must be digits")
	}
	return nil
}

// 真实形状使用 PAN 去校验位
func stripCheckDigit(pan string) string {
	if len(pan) == 0 {
		return pan
	}
	return pan[:len(pan)-1]
}

// StaticCVVDemoStrict：入参对齐真实形状（PAN 去校验位 + YYMM + SC），UI/演示用；width=3(默认)/4
func StaticCVVDemoStrict(pan, expiryYYMM, serviceCode string, width int, key []byte) (string, error) {
	// 强校验
	if err := expiry.ValidateYYMM(expiryYYMM); err != nil {
		return "", err
	}
	if err := validateServiceCode(serviceCode); err != nil {
		return "", err
	}
	pNoCD, err := panNoCDStrict(pan)
	if err != nil {
		return "", err
	}

    // 域分离 + 版本标识
    width = normalizeWidth(width)
    msg := []byte(pNoCD + "|" + expiryYYMM + "|" + serviceCode + "|" + domainStatic)
    return hmacTruncatedDecimal(key, msg, nil, width), nil
}

// DynamicCVVWithTTLStrict：入参与形状与真实一致 + 返回 TTL（秒），仅 UI 展示
func DynamicCVVWithTTLStrict(pan, expiryYYMM, serviceCode string, now time.Time, step time.Duration, width int, key []byte) (cvv string, ttlSec int, err error) {
    step = normalizeStep(step)
    width = normalizeWidth(width)
	// 强校验
	if err := expiry.ValidateYYMM(expiryYYMM); err != nil {
		return "", 0, err
	}
	if err := validateServiceCode(serviceCode); err != nil {
		return "", 0, err
	}
	pNoCD, err := panNoCDStrict(pan)
	if err != nil {
		return "", 0, err
	}

	// 时间窗（与动态码绑定）
	window := now.Unix() / int64(step.Seconds())
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(window))

    // 域分离 + 版本标识
    msg := []byte(pNoCD + "|" + expiryYYMM + "|" + serviceCode + "|" + domainDynamic)

	sec := int64(step / time.Second)
	rem := int(sec - (now.Unix() % sec))
	if rem <= 0 {
		rem = int(sec)
	}

    return hmacTruncatedDecimal(key, msg, buf, width), rem, nil
}

// Wipe：姿态性清零密钥（Go 不保证绝对擦除）
func Wipe(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

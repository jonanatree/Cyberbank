package cardgen

import (
	"crypto/rand"
	"fmt"
	"strings"
)

const panLen = 16

// GeneratePAN 生成 16 位 PAN（最后一位为 Luhn 校验位）；sequence 可覆盖尾部指定位。
func GeneratePAN(bin, sequence string) (string, error) {
	// 校验 BIN（长度 6/8/9 且全为数字）
	if err := ValidateBIN(bin); err != nil {
		return "", err
	}

	// 16 位标准长度（不修改），预留 1 位校验位
	fill := panLen - 1 - len(bin)
	if fill <= 0 {
		return "", fmt.Errorf("bin too long: %s", bin)
	}
	seq := strings.TrimSpace(sequence)
	if seq != "" {
		if !IsDigits(seq) {
			return "", fmt.Errorf("sequence must be numeric")
		}
		if len(seq) > fill {
			return "", fmt.Errorf("sequence length %d exceeds %d", len(seq), fill)
		}
	}

	// 使用拒绝采样生成无偏的随机数字字符
	digitsPart, err := randomDigits(fill)
	if err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	b := []byte(digitsPart)
	if seq != "" {
		copy(b[fill-len(seq):], seq)
	}

	body := bin + string(b)
	return body + luhnCheckDigit(body), nil
}

// randomDigits 生成指定长度的数字字符串，使用拒绝采样避免模偏差。
// 逻辑：仅接受随机字节 < 250 的样本，再对 10 取模，保证 0-9 均匀分布。
func randomDigits(count int) (string, error) {
	if count <= 0 {
		return "", nil
	}
	const threshold = 250 // 256 - (256 % 10)
	var sb strings.Builder
	sb.Grow(count)
	buf := make([]byte, 64)
	for sb.Len() < count {
		// 一次读取一批，减少系统调用
		n, err := rand.Read(buf)
		if err != nil {
			return "", err
		}
		for i := 0; i < n && sb.Len() < count; i++ {
			b := buf[i]
			if b < threshold {
				sb.WriteByte('0' + (b % 10))
			}
		}
	}
	return sb.String(), nil
}

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
	// 快速将 0-9 转成单字符字符串
	return string('0' + byte(cd))
}

// ValidatePAN 校验 PAN 长度、全数字与 Luhn 校验。
// 支持 13–19 位长度，以适配潜在扩展；当前默认生成 16 位。
func ValidatePAN(pan string) error {
	if pan == "" {
		return fmt.Errorf("pan is required")
	}
	if !IsDigits(pan) {
		return fmt.Errorf("pan must contain digits only")
	}
	if l := len(pan); l < 13 || l > 19 {
		return fmt.Errorf("pan length must be 13..19 digits (got %d)", l)
	}

	body := pan[:len(pan)-1]
	cd := luhnCheckDigit(body)
	if pan[len(pan)-1] != cd[0] {
		return fmt.Errorf("invalid luhn check digit")
	}
	return nil
}

// GeneratePANWithLength 生成指定长度（13–19）的 PAN。
// 仍保留 sequence 覆盖尾部指定位（不含校验位）。
func GeneratePANWithLength(bin string, totalLen int, sequence string) (string, error) {
	if err := ValidateBIN(bin); err != nil {
		return "", err
	}
	if totalLen < 13 || totalLen > 19 {
		return "", fmt.Errorf("total length must be 13..19")
	}
	fill := totalLen - 1 - len(bin)
	if fill <= 0 {
		return "", fmt.Errorf("bin too long: %s", bin)
	}
	seq := strings.TrimSpace(sequence)
	if seq != "" {
		if !IsDigits(seq) {
			return "", fmt.Errorf("sequence must be numeric")
		}
		if len(seq) > fill {
			return "", fmt.Errorf("sequence length %d exceeds %d", len(seq), fill)
		}
	}
	digitsPart, err := randomDigits(fill)
	if err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	b := []byte(digitsPart)
	if seq != "" {
		copy(b[fill-len(seq):], seq)
	}
	body := bin + string(b)
	return body + luhnCheckDigit(body), nil
}

func ValidateBIN(bin string) error {
	if bin == "" {
		return fmt.Errorf("bin is required")
	}
	if !IsDigits(bin) {
		return fmt.Errorf("bin must contain digits only")
	}
	switch len(bin) {
	case 6, 8, 9:
		return nil
	default:
		return fmt.Errorf("bin must be 6, 8, or 9 digits")
	}

}

func IsDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// LastN / MaskPAN 供其它包复用
func LastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func MaskPAN(pan string) string {
	cleaned := NormalizePAN(pan)
	n := len(cleaned)
	if n == 0 {
		return ""
	}
	if n <= 4 {
		return strings.Repeat("*", n)
	}
	if n < 10 {
		// 保留后4位，前部全部遮蔽
		return strings.Repeat("*", n-4) + cleaned[n-4:]
	}
	return cleaned[:6] + strings.Repeat("*", n-10) + cleaned[n-4:]
}

// NormalizePAN 去除空格/横线/制表，返回纯数字字符串。
func NormalizePAN(s string) string {
	s = strings.TrimSpace(s)
	return strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '-':
			return -1
		default:
			return r
		}
	}, s)
}

// GenerateUniquePAN：回调 exists 用于检查是否已存在（推荐连到 Card Vault）。
func GenerateUniquePAN(
	bin string, totalLen int, sequence string, maxRetries int,
	exists func(string) (bool, error),
) (string, error) {
	if maxRetries <= 0 {
		maxRetries = 5
	}
	for i := 0; i <= maxRetries; i++ {
		pan, err := GeneratePANWithLength(bin, totalLen, sequence)
		if err != nil {
			return "", err
		}
		if exists == nil {
			return pan, nil
		}
		used, err := exists(pan)
		if err != nil {
			return "", fmt.Errorf("exists callback: %w", err)
		}
		if !used {
			return pan, nil
		}
	}
	return "", fmt.Errorf("failed to generate unique PAN after %d retries", maxRetries)
}

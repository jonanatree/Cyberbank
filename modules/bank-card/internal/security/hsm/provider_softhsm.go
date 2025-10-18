//go:build softhsm

package hsm

import (
    "crypto/rand"
    "encoding/hex"
    "fmt"
    "time"

    "github.com/miekg/pkcs11"

    "github.com/alovak/cardflow-playground/internal/cardgen"
    "github.com/alovak/cardflow-playground/internal/expiry"
    "github.com/alovak/cardflow-playground/internal/security"
)

// SoftHSMProvider：基于 PKCS#11 的 3DES MAC + 十进制化演示实现（接近真实）。
// 通过 build tag softhsm 启用，避免默认构建依赖 pkcs11。
type SoftHSMProvider struct {
    libPath  string
    slotID   uint
    pin      string
    cvkLabel string
    p11      *pkcs11.Ctx
    sess     pkcs11.SessionHandle
    cvk      pkcs11.ObjectHandle
}

func NewSoftHSMProvider(libPath string, slotID uint, pin, cvkLabel string) *SoftHSMProvider {
    return &SoftHSMProvider{libPath: libPath, slotID: slotID, pin: pin, cvkLabel: cvkLabel}
}

func (p *SoftHSMProvider) Open() error {
    p.p11 = pkcs11.New(p.libPath)
    if p.p11 == nil {
        return fmt.Errorf("load pkcs11 lib failed")
    }
    if err := p.p11.Initialize(); err != nil {
        return err
    }
    sess, err := p.p11.OpenSession(pkcs11.SlotID(p.slotID), pkcs11.CKF_SERIAL_SESSION|pkcs11.CKF_RW_SESSION)
    if err != nil {
        _ = p.p11.Finalize()
        return err
    }
    p.sess = sess
    if err := p.p11.Login(p.sess, pkcs11.CKU_USER, p.pin); err != nil {
        _ = p.p11.CloseSession(p.sess)
        _ = p.p11.Finalize()
        return err
    }

    // 找到 3DES CVK 密钥
    template := []*pkcs11.Attribute{
        pkcs11.NewAttribute(pkcs11.CKA_LABEL, p.cvkLabel),
        pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_SECRET_KEY),
        pkcs11.NewAttribute(pkcs11.CKA_KEY_TYPE, pkcs11.CKK_DES3),
    }
    if err := p.p11.FindObjectsInit(p.sess, template); err != nil {
        return err
    }
    objs, _, err := p.p11.FindObjects(p.sess, 1)
    _ = p.p11.FindObjectsFinal(p.sess)
    if err != nil {
        return err
    }
    if len(objs) == 0 {
        return fmt.Errorf("cvk not found by label=%s", p.cvkLabel)
    }
    p.cvk = objs[0]
    return nil
}

func (p *SoftHSMProvider) Close() {
    if p.p11 != nil {
        if p.sess != 0 {
            _ = p.p11.Logout(p.sess)
            _ = p.p11.CloseSession(p.sess)
        }
        _ = p.p11.Finalize()
        p.p11.Destroy()
        p.p11 = nil
    }
}

// assembleData：按真实形状组装：panNoCD + YYMM + SC (+ 可选 window 计数的 8 字节BE，附加为HEX)。
func assembleData(panNoCD, yymm, sc string, window *uint64) []byte {
    s := panNoCD + yymm + sc
    if window != nil {
        w := make([]byte, 8)
        for i := 0; i < 8; i++ {
            w[7-i] = byte((*window) >> (8 * i))
        }
        s += hex.EncodeToString(w)
    }
    return []byte(s)
}

// decimalize：将 MAC 字节转 hex，再将 a..f 十进制化为 0..9（演示用 nibble%10），取前 n 位。
func decimalize(mac []byte, n int) string {
    hx := hex.EncodeToString(mac)
    out := make([]byte, 0, n)
    for i := 0; i < len(hx) && len(out) < n; i++ {
        c := hx[i]
        if c >= '0' && c <= '9' {
            out = append(out, c)
        } else { // a..f
            v := (c - 'a' + 10) % 10
            out = append(out, byte('0'+v))
        }
    }
    for len(out) < n {
        b := make([]byte, 1)
        _, _ = rand.Read(b)
        out = append(out, '0'+(b[0]%10))
    }
    return string(out)
}

func (p *SoftHSMProvider) mac(data []byte) ([]byte, error) {
    mech := []*pkcs11.Mechanism{pkcs11.NewMechanism(pkcs11.CKM_DES3_MAC, nil)}
    if err := p.p11.SignInit(p.sess, mech, p.cvk); err != nil {
        return nil, err
    }
    mac, err := p.p11.Sign(p.sess, data)
    if err != nil {
        return nil, err
    }
    return mac, nil
}

// SoftHSMProvider 实现 security.CVVProvider
func (p *SoftHSMProvider) ComputeCVV2(panNoCD, yymm, sc string, width int) (string, error) {
    if width != 4 { // 仅接受 3 或 4，其他回落到 3
        width = 3
    }
    if err := expiry.ValidateYYMM(yymm); err != nil {
        return "", err
    }
    if len(sc) != 3 || !cardgen.IsDigits(sc) {
        return "", fmt.Errorf("service code must be 3 digits")
    }
    if panNoCD == "" || !cardgen.IsDigits(panNoCD) {
        return "", fmt.Errorf("panNoCD must be digits only")
    }
    data := assembleData(panNoCD, yymm, sc, nil)
    mac, err := p.mac(data)
    if err != nil {
        return "", err
    }
    return decimalize(mac, width), nil
}

func (p *SoftHSMProvider) ComputeDisplayDCVV(panNoCD, yymm, sc string, step time.Duration, width int) (string, int, error) {
    // 归一化步长：至少1s、按秒对齐
    if step < time.Second {
        step = time.Second
    } else {
        step = (step / time.Second) * time.Second
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
    if panNoCD == "" || !cardgen.IsDigits(panNoCD) {
        return "", 0, fmt.Errorf("panNoCD must be digits only")
    }
    now := time.Now().UTC()
    window := uint64(now.Unix()) / uint64(step.Seconds())
    data := assembleData(panNoCD, yymm, sc, &window)
    mac, err := p.mac(data)
    if err != nil {
        return "", 0, err
    }
    ttl := int(int64(step.Seconds()) - (now.Unix() % int64(step.Seconds())))
    if ttl <= 0 {
        ttl = int(step.Seconds())
    }
    return decimalize(mac, width), ttl, nil
}

var _ security.CVVProvider = (*SoftHSMProvider)(nil)

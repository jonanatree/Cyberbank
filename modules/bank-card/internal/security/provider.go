package security

import "time"

// CVVProvider 是统一的 CVV 计算契约。
// 注意：这是演示/集成层接口，具体实现可为严格 Demo（HMAC-SHA256）或 HSM（3DES MAC）。
type CVVProvider interface {
    // ComputeCVV2 计算“真实形状”的 CVV：入参为 PAN 去校验位（panNoCD）、YYMM、3位 Service Code。
    // width 取 3 或 4（其他值将按实现默认到 3）。
    ComputeCVV2(panNoCD, expiryYYMM, serviceCode string, width int) (string, error)

    // ComputeDisplayDCVV 计算用于 UI 展示的动态 CVV，返回 {cvv, ttlSec}。
    // step 为时间窗大小，width 取 3 或 4（其他值将按实现默认到 3）。
    ComputeDisplayDCVV(panNoCD, expiryYYMM, serviceCode string, step time.Duration, width int) (string, int, error)
}


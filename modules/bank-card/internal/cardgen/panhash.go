package cardgen

import (
    "crypto/hmac"
    "crypto/sha256"
)

// HashPANHMAC computes HMAC-SHA256 over a PAN using a secret key (pepper).
// Do not log or persist the input PAN here; callers must sanitize logs separately.
func HashPANHMAC(pan string, key []byte) []byte {
    h := hmac.New(sha256.New, key)
    h.Write([]byte(pan))
    return h.Sum(nil)
}


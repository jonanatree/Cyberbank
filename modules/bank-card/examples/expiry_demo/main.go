package main

import (
    "fmt"
    "time"

    "github.com/alovak/cardflow-playground/internal/expiry"
)

func main() {
    // Use a fixed date for reproducible output
    now := time.Date(2025, time.October, 11, 12, 0, 0, 0, time.UTC)

    fmt.Println("YYMM:", expiry.YYMM(now, 5))     // ISO8583 format
    fmt.Println("MMYY:", expiry.MMYY(now, 5))     // API/UI alt format
    fmt.Println("Face:", expiry.CardFace(now, 5)) // Card face format
}


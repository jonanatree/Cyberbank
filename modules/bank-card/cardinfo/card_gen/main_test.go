//go:build demo

package main

import "testing"

func TestNormalizeCardName(t *testing.T) {
    cases := []struct{
        in  string
        out string
    }{
        {"", ""},
        {"   ", ""},
        {"john  doe", "JOHN DOE"},
        {"  Alice\tSmith  ", "ALICE SMITH"},
        {"very very very very very long name here", "VERY VERY VERY VERY VERY L"}, // 26 chars
    }
    for _, c := range cases {
        got := normalizeCardName(c.in)
        if got != c.out {
            t.Fatalf("normalizeCardName(%q) = %q want %q", c.in, got, c.out)
        }
    }
}

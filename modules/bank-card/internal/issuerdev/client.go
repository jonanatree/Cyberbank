package issuerdev

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	Base string
	HTTP *http.Client
}

func New(base string, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{Base: strings.TrimRight(base, "/"), HTTP: hc}
}

type IssueReq struct {
	PAN            string `json:"pan"` // dev only；生产期应改为 token
	ExpiryYYMM     string `json:"expiryYYMM"`
	CardholderName string `json:"cardholderName,omitempty"`
	Description    string `json:"description,omitempty"`
}

func (c *Client) EnsurePANUnique(ctx context.Context, pan string) error {
	u, err := url.Parse(c.Base + "/dev/cards/unique-check")
	if err != nil {
		return fmt.Errorf("parse base: %w", err)
	}
	q := u.Query()
	q.Set("pan", pan)
	u.RawQuery = q.Encode()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("unique-check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil // 未实现 → 跳过
	}
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unique-check status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(b)))
	}

	var payload struct {
		Unique bool `json:"unique"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return fmt.Errorf("decode unique-check: %w", err)
	}
	if !payload.Unique {
		return fmt.Errorf("issuer reports PAN already exists")
	}
	return nil
}

func (c *Client) IssueExternal(ctx context.Context, accountID string, req IssueReq) error {
	target := fmt.Sprintf("%s/dev/accounts/%s/cards/issue-external", c.Base, accountID)
	b, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(b)))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return fmt.Errorf("issue-external: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("issue-external status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

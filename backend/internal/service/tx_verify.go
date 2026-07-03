package service

// W2.3 (BE-3): CompleteTransaction stores a CLIENT-supplied final_hash. It is
// display/dedup metadata, not an authz primitive — but storing it unverified
// means the UI presents an unconfirmed claim as fact. txExistsOnChain does a
// best-effort Tendermint /tx lookup at completion time so the row can carry
// verified=true/false. Availability must never block completion: any
// transport problem leaves verified=false, it never fails the RPC.

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var hexHashRe = regexp.MustCompile(`^(0x|0X)?[0-9a-fA-F]{64}$`)

// normalizeTxHashHex converts a wallet- or RPC-shaped tx hash to bare 64-char
// hex. Adena returns base64 (32 bytes); the Tendermint RPC returns upper hex.
func normalizeTxHashHex(h string) (string, error) {
	h = strings.TrimSpace(h)
	if hexHashRe.MatchString(h) {
		return strings.ToUpper(strings.TrimPrefix(strings.TrimPrefix(h, "0x"), "0X")), nil
	}
	if raw, err := base64.StdEncoding.DecodeString(h); err == nil && len(raw) == 32 {
		return strings.ToUpper(hex.EncodeToString(raw)), nil
	}
	return "", fmt.Errorf("unrecognized tx hash shape (want 64-hex or base64 of 32 bytes)")
}

// txExistsOnChain reports whether the tx hash is found on the chain via the
// Tendermint /tx endpoint. (false, nil) = the chain answered "not found";
// a non-nil error = we could not get an answer (leave verified=false).
func txExistsOnChain(ctx context.Context, rpcURL, finalHash string) (bool, error) {
	hexHash, err := normalizeTxHashHex(finalHash)
	if err != nil {
		return false, err
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	u := strings.TrimRight(rpcURL, "/") + "/tx?hash=0x" + url.QueryEscape(hexHash)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = res.Body.Close() }()

	var body struct {
		Result *struct {
			Hash string `json:"hash"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
			Data    string `json:"data"`
		} `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return false, fmt.Errorf("decode /tx response: %w", err)
	}
	if body.Error != nil {
		// Tendermint answers "tx (...) not found" as a JSON-RPC error — that
		// is a definitive NO from the chain, not an availability failure.
		if strings.Contains(strings.ToLower(body.Error.Message+" "+body.Error.Data), "not found") {
			return false, nil
		}
		return false, fmt.Errorf("/tx RPC error: %s %s", body.Error.Message, body.Error.Data)
	}
	return body.Result != nil && body.Result.Hash != "", nil
}

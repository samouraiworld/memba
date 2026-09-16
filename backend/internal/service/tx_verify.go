package service

// Tx hash normalization shared by the native completion path, which only
// records a final_hash after validating the chain receipt against the stored
// proposal. Legacy records never record one (see CompleteTransaction).

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
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

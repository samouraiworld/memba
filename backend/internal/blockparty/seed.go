package blockparty

import (
	"crypto/sha256"
	"encoding/binary"
)

// DeriveSeed = SHA256(blockHash ‖ "blockparty:" ‖ date), first 4 bytes big-endian.
// Domain-separated so the block hash cannot be confused with any other use.
func DeriveSeed(blockHash, date string) uint32 {
	h := sha256.Sum256([]byte(blockHash + "blockparty:" + date))
	return binary.BigEndian.Uint32(h[:4])
}

var modifiers = []string{"standard", "doubles", "rush"}

func DeriveModifier(seed uint32) string {
	return modifiers[seed%uint32(len(modifiers))]
}

// DerivePar is a stable, seed-derived target score for the day (v1 heuristic;
// refined to a rolling median once submission data exists). Deterministic.
func DerivePar(seed uint32) int64 {
	return 1000 + int64(seed%2000) // 1000..2999
}

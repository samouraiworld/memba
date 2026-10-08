package account

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
)

// deletionDigest binds the retained security marker to this versioned
// purpose and verified identity namespace. It stores neither the provider
// subject itself nor any address/consent; it remains pseudonymous data.
func deletionDigest(provider, subject string) string {
	sum := sha256.Sum256([]byte("memba-account-deletion-v1\x00" + Issuer + "\x00" + provider + "\x00" + subject))
	return hex.EncodeToString(sum[:])
}

func wasDeleted(ctx context.Context, db *sql.DB, subject string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM account_deletions WHERE subject_digest = ?)", deletionDigest(idp, subject)).Scan(&exists)
	return exists, err
}

func deletedAccount(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusGone)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  "account_deleted",
		"error": "This Memba account was deleted. Sign out to finish deletion.",
	})
}

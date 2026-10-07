package account

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"
)

// Account is the row Memba keeps for a signed-in person.
type Account struct {
	ID              string `json:"id"`
	Email           string `json:"email,omitempty"`
	EmailVerifiedAt string `json:"emailVerifiedAt,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

const idp = "clerk"

// Ensure returns the account of a verified session. The first call creates
// it; every call keeps the stored email equal to the provider's verified one
// (none when the provider reports it unverified).
func Ensure(ctx context.Context, db *sql.DB, c Claims, now time.Time) (Account, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return Account{}, err
	}
	at := now.UTC().Format(time.RFC3339)
	if _, err := db.ExecContext(ctx,
		"INSERT OR IGNORE INTO accounts (id, idp, idp_subject, created_at) VALUES (?, ?, ?, ?)",
		hex.EncodeToString(id), idp, c.Subject, at,
	); err != nil {
		return Account{}, err
	}
	var a Account
	var email, verifiedAt sql.NullString
	if err := db.QueryRowContext(ctx,
		"SELECT id, email, email_verified_at, created_at FROM accounts WHERE idp = ? AND idp_subject = ?",
		idp, c.Subject,
	).Scan(&a.ID, &email, &verifiedAt, &a.CreatedAt); err != nil {
		return Account{}, err
	}
	a.Email, a.EmailVerifiedAt = email.String, verifiedAt.String
	if a.Email == c.Email {
		return a, nil
	}
	// A new address starts deliverable; no address means no verification time.
	a.Email, a.EmailVerifiedAt = c.Email, ""
	var stored, verified any
	if c.Email != "" {
		a.EmailVerifiedAt = at
		stored, verified = c.Email, at
	}
	_, err := db.ExecContext(ctx,
		"UPDATE accounts SET email = ?, email_verified_at = ?, email_undeliverable_at = NULL WHERE id = ?",
		stored, verified, a.ID,
	)
	return a, err
}

// Delete removes the account; every row that references it goes with it
// (ON DELETE CASCADE).
func Delete(ctx context.Context, db *sql.DB, id string) error {
	_, err := db.ExecContext(ctx, "DELETE FROM accounts WHERE id = ?", id)
	return err
}

package account

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// Account is the row Memba keeps for a signed-in person.
type Account struct {
	ID              string `json:"id"`
	Email           string `json:"email,omitempty"`
	EmailVerifiedAt string `json:"emailVerifiedAt,omitempty"`
	// EmailUndeliverable: the provider reported a permanent bounce or a complaint for this address.
	EmailUndeliverable bool   `json:"emailUndeliverable,omitempty"`
	CreatedAt          string `json:"createdAt"`
	emailChangedAt     string
}

const idp = "clerk"

// Ensure returns the account of a verified session, creating it on first use.
// It does not change the stored address: (*handler).followEmail does, after
// the email provider has let go of the old one.
func Ensure(ctx context.Context, db *sql.DB, subject string, now time.Time) (Account, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return Account{}, err
	}
	if _, err := db.ExecContext(ctx,
		"INSERT OR IGNORE INTO accounts (id, idp, idp_subject, created_at) VALUES (?, ?, ?, ?)",
		hex.EncodeToString(id), idp, subject, now.UTC().Format(time.RFC3339),
	); err != nil {
		return Account{}, err
	}
	var a Account
	var email, verifiedAt, undeliverable, changedAt sql.NullString
	if err := db.QueryRowContext(ctx,
		"SELECT id, email, email_verified_at, email_undeliverable_at, email_changed_at, created_at FROM accounts WHERE idp = ? AND idp_subject = ?",
		idp, subject,
	).Scan(&a.ID, &email, &verifiedAt, &undeliverable, &changedAt, &a.CreatedAt); err != nil {
		return Account{}, err
	}
	a.Email, a.EmailVerifiedAt, a.EmailUndeliverable, a.emailChangedAt = email.String, verifiedAt.String, undeliverable.Valid, changedAt.String
	return a, nil
}

// setEmail stores the provider's verified address (none when it reports it
// unverified), only if the stored one is still `from`: concurrent calls change
// it once. It reports whether this call changed it.
func setEmail(ctx context.Context, tx *sql.Tx, a *Account, from, to string, now time.Time) (bool, error) {
	at := now.UTC().Format(time.RFC3339)
	var stored, verified any
	if to != "" {
		stored, verified = to, at
	}
	res, err := tx.ExecContext(ctx,
		"UPDATE accounts SET email = ?, email_verified_at = ?, email_undeliverable_at = NULL, email_changed_at = ? WHERE id = ? AND email IS ?",
		stored, verified, at, a.ID, nullable(from),
	)
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err != nil || n != 1 {
		return false, err
	}
	a.Email, a.EmailVerifiedAt, a.EmailUndeliverable, a.emailChangedAt = to, "", false, at
	if to != "" {
		a.EmailVerifiedAt = at
	}
	return true, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Delete atomically records the pseudonymous denial marker and removes the
// account plus every owned row (cascade). Neither half may commit alone.
func Delete(ctx context.Context, db *sql.DB, id string, now time.Time) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var provider, subject string
	if err := tx.QueryRowContext(ctx, "SELECT idp, idp_subject FROM accounts WHERE id = ?", id).Scan(&provider, &subject); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO account_deletions (subject_digest, deleted_at) VALUES (?, ?)",
		deletionDigest(provider, subject), now.UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, "DELETE FROM accounts WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil || n != 1 {
		return errors.New("account deletion did not remove the account")
	}
	return tx.Commit()
}

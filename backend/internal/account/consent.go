package account

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// Topics a person may opt in to, all off by default; Early access carries the apps chosen.
var (
	topics          = []string{"announcements", "newsletter", "early_access"}
	earlyAccessApps = map[string]bool{"launchpad": true, "nft": true, "session-accounts": true}
)

func knownTopic(t string) bool {
	for _, k := range topics {
		if k == t {
			return true
		}
	}
	return false
}

// Consent is one request, as stored (append-only).
type Consent struct {
	ID              int64  `json:"id"`
	Topic           string `json:"topic"`
	Scope           string `json:"scope,omitempty"`
	Email           string `json:"email"`
	WordingVersion  string `json:"wordingVersion"`
	Source          string `json:"source"`
	RequestedAt     string `json:"requestedAt"`
	ConfirmedAt     string `json:"confirmedAt,omitempty"`
	WithdrawnAt     string `json:"withdrawnAt,omitempty"`
	WithdrawnReason string `json:"withdrawnReason,omitempty"`
}

// TopicState is a topic as the person sees it: on while a confirmed request
// is live (a newer request, pending or expired, does not hide it), else
// pending while a confirmation email is open, else off.
type TopicState struct {
	Topic string `json:"topic"`
	State string `json:"state"`
	Scope string `json:"scope,omitempty"`
}

const consentCols = "id, topic, scope, email, wording_version, source, requested_at, COALESCE(confirmed_at, ''), COALESCE(withdrawn_at, ''), COALESCE(withdrawn_reason, '')"

func scanConsents(rows *sql.Rows) ([]Consent, error) {
	defer func() { _ = rows.Close() }()
	var out []Consent
	for rows.Next() {
		var c Consent
		if err := rows.Scan(&c.ID, &c.Topic, &c.Scope, &c.Email, &c.WordingVersion, &c.Source, &c.RequestedAt, &c.ConfirmedAt, &c.WithdrawnAt, &c.WithdrawnReason); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// consents returns every request of the account, oldest first.
func consents(ctx context.Context, db *sql.DB, accountID string) ([]Consent, error) {
	rows, err := db.QueryContext(ctx, "SELECT "+consentCols+" FROM consents WHERE account_id = ? ORDER BY id", accountID)
	if err != nil {
		return nil, err
	}
	return scanConsents(rows)
}

func topicStates(all []Consent, now time.Time) []TopicState {
	out := make([]TopicState, 0, len(topics))
	for _, t := range topics {
		ts := TopicState{Topic: t, State: "off"}
		for _, c := range all { // oldest first: the newest live request of a kind wins
			switch {
			case c.Topic != t || c.WithdrawnAt != "":
			case c.ConfirmedAt != "":
				ts.State, ts.Scope = "on", c.Scope
			case ts.State != "on" && !expired(c.RequestedAt, now):
				ts.State, ts.Scope = "pending", c.Scope
			}
		}
		out = append(out, ts)
	}
	return out
}

func expired(requestedAt string, now time.Time) bool {
	t, err := time.Parse(time.RFC3339, requestedAt)
	return err != nil || now.Sub(t) > linkTTL
}

// withdraw closes the live (not withdrawn) requests matching where/args.
func withdraw(ctx context.Context, tx *sql.Tx, now time.Time, reason, where string, args ...any) error {
	_, err := tx.ExecContext(ctx, "UPDATE consents SET withdrawn_at = ?, withdrawn_reason = ? WHERE withdrawn_at IS NULL AND "+where,
		append([]any{now.UTC().Format(time.RFC3339), reason}, args...)...)
	return err
}

// validScope keeps only a comma-separated list of known Early access apps.
func validScope(topic, scope string) bool {
	if topic != "early_access" {
		return scope == ""
	}
	for _, a := range strings.Split(scope, ",") { // "" splits to [""], which is refused
		if !earlyAccessApps[a] {
			return false
		}
	}
	return true
}

// sweep deletes requests nobody confirmed in time and the webhook replay ledger's old entries.
func sweep(ctx context.Context, db *sql.DB, now time.Time) error {
	cutoff := now.Add(-linkTTL).UTC().Format(time.RFC3339)
	if _, err := db.ExecContext(ctx, "DELETE FROM consents WHERE confirmed_at IS NULL AND withdrawn_at IS NULL AND requested_at < ?", cutoff); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, "DELETE FROM webhook_events WHERE received_at < ?", cutoff)
	return err
}

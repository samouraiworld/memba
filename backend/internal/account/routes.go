package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"
)

var topicLabels = map[string]string{"announcements": "product announcements", "newsletter": "the newsletter", "early_access": "early access news"}

// requestCooldown spaces confirmation emails for one topic of one account.
const requestCooldown = 10 * time.Minute

func (h *handler) get(w http.ResponseWriter, _ *http.Request, a Account) {
	writeJSON(w, a)
}

func (h *handler) export(w http.ResponseWriter, r *http.Request, a Account) {
	all, err := consents(r.Context(), h.db, a.ID)
	if err != nil {
		h.fail(w, "export", err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="memba-account.json"`)
	writeJSON(w, Export{Account: a, Consents: all})
}

// delete withdraws Memba topics for every address the account ever gave
// first: if one fails, Memba deletes nothing and the person can try again.
// The account operation guard keeps this address set stable through provider
// I/O and the final cascade. On failure, every local cleanup reference stays
// available for a retry, including after a process restart.
func (h *handler) delete(w http.ResponseWriter, r *http.Request, a Account) {
	emails, err := addresses(r.Context(), h.db, a)
	if err != nil {
		h.fail(w, "delete", err)
		return
	}
	for _, email := range emails {
		if err := h.withdrawMemba(r.Context(), email); err != nil {
			slog.Error("account: withdraw email topics", "error", err)
			writeError(w, http.StatusBadGateway, "the email provider did not answer, so Memba deleted nothing yet (the provider may have disabled some Memba subscriptions already); try again")
			return
		}
	}
	if err := Delete(r.Context(), h.db, a.ID, h.now()); err != nil {
		h.fail(w, "delete", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// addresses are the account's current address and every address a consent named.
func addresses(ctx context.Context, db *sql.DB, a Account) ([]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT DISTINCT email FROM consents WHERE account_id = ?", a.ID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	seen := map[string]bool{}
	var out []string
	if a.Email != "" {
		seen[a.Email], out = true, append(out, a.Email)
	}
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			return nil, err
		}
		if !seen[e] {
			seen[e], out = true, append(out, e)
		}
	}
	return out, rows.Err()
}

func (h *handler) getTopics(w http.ResponseWriter, r *http.Request, a Account) {
	all, err := consents(r.Context(), h.db, a.ID)
	if err != nil {
		h.fail(w, "topics", err)
		return
	}
	writeJSON(w, topicStates(all, h.now()))
}

type topicRequest struct {
	Topic          string `json:"topic"`
	On             bool   `json:"on"`
	Scope          string `json:"scope"`
	Source         string `json:"source"`
	WordingVersion string `json:"wordingVersion"`
}

// setTopic turns a topic off at once (the email provider first, so no
// broadcast reaches a withdrawn address), or records a request and sends its
// confirmation email: nothing is "on" until the person confirms (double opt-in).
func (h *handler) setTopic(w http.ResponseWriter, r *http.Request, a Account) {
	var req topicRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil || !knownTopic(req.Topic) || (req.On && !validScope(req.Topic, req.Scope)) ||
		len(req.Source) > 64 || len(req.WordingVersion) > 32 || (req.On && (req.Source == "" || req.WordingVersion == "")) {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	ctx, now := r.Context(), h.now()
	if !req.On {
		if a.Email != "" {
			if err := h.resend.setTopic(ctx, a.Email, h.topicIDs[req.Topic], false); err != nil {
				slog.Error("account: opt out", "error", err)
				writeError(w, http.StatusBadGateway, "the email provider did not answer; try again")
				return
			}
		}
		if err := h.inTx(ctx, func(tx *sql.Tx) error {
			return withdraw(ctx, tx, now, "user", "account_id = ? AND topic = ?", a.ID, req.Topic)
		}); err != nil {
			h.fail(w, "opt out", err)
			return
		}
		// A confirmation can opt back in while the provider-first opt-out is
		// in flight. Reconcile after withdrawal so its later completion cannot
		// leave the provider subscribed to a consent we just closed.
		if a.Email != "" {
			if err := h.undoOptIn(ctx, boundRequest{AccountID: a.ID, Topic: req.Topic, Email: a.Email}); err != nil {
				writeError(w, http.StatusBadGateway, "your withdrawal is recorded, but the email provider did not confirm it; try again")
				return
			}
		}
		h.getTopics(w, r, a)
		return
	}
	if a.Email == "" || a.EmailUndeliverable {
		writeError(w, http.StatusConflict, "a verified email that receives mail is needed")
		return
	}
	all, err := consents(ctx, h.db, a.ID)
	if err != nil {
		h.fail(w, "request", err)
		return
	}
	for _, c := range all {
		if c.Topic != req.Topic || c.WithdrawnAt != "" || c.Email != a.Email {
			continue
		}
		if c.ConfirmedAt != "" && c.Scope == req.Scope {
			h.getTopics(w, r, a) // already on, as asked: nothing to send
			return
		}
		if c.ConfirmedAt == "" && !expired(c.RequestedAt, now) && !requestedBefore(c.RequestedAt, now.Add(-requestCooldown)) {
			writeError(w, http.StatusTooManyRequests, "a confirmation email was sent a few minutes ago: check your inbox, or ask again in 10 minutes")
			return
		}
	}
	if err := h.request(ctx, a, req.Topic, req.Scope, req.WordingVersion, req.Source); err != nil {
		slog.Error("account: request consent", "error", err)
		writeError(w, http.StatusBadGateway, "the confirmation email could not be sent; try again")
		return
	}
	h.getTopics(w, r, a)
}

func requestedBefore(requestedAt string, t time.Time) bool {
	at, err := time.Parse(time.RFC3339, requestedAt)
	return err != nil || at.Before(t)
}

// request records a pending request for the account's current address and
// emails its one-time link. Sent, it replaces the topic's other open request
// (one open request per topic); not sent, it is removed.
func (h *handler) request(ctx context.Context, a Account, topic, scope, wording, source string) error {
	now := h.now()
	at := now.UTC().Format(time.RFC3339)
	res, err := h.db.ExecContext(ctx,
		"INSERT INTO consents (account_id, topic, scope, email, wording_version, source, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		a.ID, topic, scope, a.Email, wording, source, at)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	link := linkFor(h.linkSecret, boundRequest{ID: id, AccountID: a.ID, Topic: topic, Email: a.Email, RequestedAt: at})
	text := "Someone asked to receive " + topicLabels[topic] + " from Memba at this address.\n\n" +
		"Confirm here: " + AuthorizedParty + "/os/confirm?t=" + link + "\n\n" +
		"The link works once, for 7 days. If it was not you, ignore this email: nothing is sent without your confirmation.\n"
	if err := h.resend.send(ctx, a.Email, "Confirm: Memba "+topicLabels[topic], text); err != nil {
		_, _ = h.db.ExecContext(ctx, "DELETE FROM consents WHERE id = ?", id)
		return err
	}
	return h.inTx(ctx, func(tx *sql.Tx) error {
		return withdraw(ctx, tx, now, "superseded", "account_id = ? AND topic = ? AND confirmed_at IS NULL AND id != ?", a.ID, topic, id)
	})
}

var errUsed = errors.New("link used or request closed")

// confirm turns one pending request on. Unauthenticated: the link's MAC over
// the stored request is the proof; the request must still be open and its
// address still the account's. Any failure after the provider's opt-in opts
// back out, unless another confirmed request of that topic keeps it on.
func (h *handler) confirm(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body)
	ctx, now := r.Context(), h.now()
	id, mac, err := parseLink(body.Token)
	invalid := func() { writeError(w, http.StatusBadRequest, "This link is invalid or has expired.") }
	used := func() {
		writeError(w, http.StatusGone, "This link was already used, or the request it confirms is no longer open.")
	}
	if err != nil {
		invalid()
		return
	}
	b := boundRequest{ID: id}
	var accountEmail, subject string
	var confirmed, withdrawn, undeliverable sql.NullString
	load := func() error {
		return h.db.QueryRowContext(ctx, `SELECT c.account_id, c.topic, c.email, c.requested_at, c.confirmed_at, c.withdrawn_at, COALESCE(a.email, ''), a.email_undeliverable_at, a.idp_subject
		FROM consents c JOIN accounts a ON a.id = c.account_id WHERE c.id = ?`, id).
			Scan(&b.AccountID, &b.Topic, &b.Email, &b.RequestedAt, &confirmed, &withdrawn, &accountEmail, &undeliverable, &subject)
	}
	// Authenticate the link before reserving a subject's operation slot.
	if load() != nil || !b.issuedFor(h.linkSecret, mac) || expired(b.RequestedAt, now) {
		invalid()
		return
	}
	release, ok := beginOperation(w, subject)
	if !ok {
		return
	}
	defer release()
	// Another operation may have completed between the first read and the
	// reservation. Never authorize provider changes from that old snapshot.
	if load() != nil || !b.issuedFor(h.linkSecret, mac) || expired(b.RequestedAt, h.now()) {
		invalid()
		return
	}
	if confirmed.Valid || withdrawn.Valid || accountEmail != b.Email || undeliverable.Valid {
		used()
		return
	}
	if err := h.resend.setTopic(ctx, b.Email, h.topicIDs[b.Topic], true); err != nil {
		_ = h.undoOptIn(ctx, b) // the call may have been applied before it failed; failures are logged
		if errors.Is(err, errGloballyUnsubscribed) {
			writeError(w, http.StatusConflict, "This address is unsubscribed from emails across our shared email provider. Memba cannot change that global preference.")
			return
		}
		slog.Error("account: opt in", "error", err)
		writeError(w, http.StatusBadGateway, "the email provider did not answer; try the link again")
		return
	}
	at := now.UTC().Format(time.RFC3339)
	err = h.inTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "UPDATE consents SET confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL AND withdrawn_at IS NULL", at, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return errUsed
		}
		return withdraw(ctx, tx, now, "superseded", "account_id = ? AND topic = ? AND id != ?", b.AccountID, b.Topic, id)
	})
	if err != nil {
		_ = h.undoOptIn(ctx, b) // this response already reports failure; reconciliation failures are logged
		if errors.Is(err, errUsed) {
			used()
			return
		}
		h.fail(w, "confirm", err)
		return
	}
	writeJSON(w, map[string]string{"topic": b.Topic, "state": "on"})
}

// undoOptIn opts the address back out of the topic at the provider, unless a
// confirmed request is known to keep it on. It fails closed: when that cannot
// be read, it opts out. It outlives the request (a cancelled one included).
func (h *handler) undoOptIn(ctx context.Context, b boundRequest) error {
	ctx = context.WithoutCancel(ctx)
	var live int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM consents WHERE account_id = ? AND topic = ? AND email = ? AND confirmed_at IS NOT NULL AND withdrawn_at IS NULL",
		b.AccountID, b.Topic, b.Email).Scan(&live); err == nil && live > 0 {
		return nil
	}
	if err := h.resend.setTopic(ctx, b.Email, h.topicIDs[b.Topic], false); err != nil {
		slog.Error("account: undo opt-in", "error", err)
		return err
	}
	return nil
}

// reconcileMembaWithdrawal reconciles Memba opt-outs again after local withdrawal.
// It never removes the shared contact or changes another project's preferences.
func (h *handler) reconcileMembaWithdrawal(ctx context.Context, email string) {
	ctx = context.WithoutCancel(ctx)
	var err error
	for try := 0; try < 3; try++ {
		if err = h.withdrawMemba(ctx, email); err == nil {
			return
		}
		time.Sleep(time.Duration(try+1) * 200 * time.Millisecond)
	}
	slog.Error("account: reconcile Memba withdrawal", "error", err)
}

// followEmail keeps the stored address equal to the provider's verified one.
// A session issued before the last change cannot change it back. The email
// provider lets go of the old address first (on failure nothing changes and
// the next call tries again); then, in one transaction, the address changes
// once and every request still open for the old address is withdrawn.
func (h *handler) followEmail(ctx context.Context, a Account, c Claims) (Account, error) {
	if a.Email == c.Email {
		return a, nil
	}
	if changed, err := time.Parse(time.RFC3339, a.emailChangedAt); err == nil && c.IssuedAt.Before(changed) {
		return a, nil
	}
	previous := a.Email
	var live []Consent
	if previous != "" {
		all, err := consents(ctx, h.db, a.ID)
		if err != nil {
			return a, err
		}
		for _, x := range all {
			if x.Email == previous && x.WithdrawnAt == "" {
				live = append(live, x)
			}
		}
		if err := h.withdrawMemba(ctx, previous); err != nil {
			return a, err
		}
	}
	now := h.now()
	err := h.inTx(ctx, func(tx *sql.Tx) error {
		changed, err := setEmail(ctx, tx, &a, previous, c.Email, now)
		if err != nil || !changed {
			return err
		}
		return withdraw(ctx, tx, now, "email_changed", "account_id = ? AND email = ?", a.ID, previous)
	})
	if err != nil {
		return a, err
	}
	if previous != "" {
		h.reconcileMembaWithdrawal(ctx, previous)
	}
	h.afterEmailChange(ctx, a, previous, live)
	return a, nil
}

func (h *handler) inTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (h *handler) fail(w http.ResponseWriter, what string, err error) {
	slog.Error("account: "+what, "error", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

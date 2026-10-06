// Package launchpadwatch compares what the Launchpad realms hold with what they
// owe, and pages the pauser when a stable reading breaks a rule:
//
//   - view: the books are not the view this watcher was written for (a wrong
//     deploy, or a read of another realm);
//   - deficit: the balance is below what is owed on two stable readings in a
//     row (a bug or a chain-level fault: the realms assert the opposite after
//     every movement);
//   - surplus_fell: balance minus owed fell below the stored value. It only
//     ever rises (coins sent outside the entry points), so a fall means coins
//     owed to no one were spent, or an exit paid more than it recorded.
//
// Readings come from one node, identity-checked before each one; a node that
// answers for another chain never decides anything.
package launchpadwatch

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"time"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// Config is the watcher's environment.
type Config struct {
	RPCURL     string
	ChainID    string
	WebhookURL string
	Interval   time.Duration
	// InjectBalanceOffset is added to every stable balance, to rehearse a page
	// on onyx-1. It is refused on any other chain.
	InjectBalanceOffset int64
}

// rehearsalChain is the only chain an injected offset may run on.
const rehearsalChain = "onyx-1"

// unreadableAfter is how long the books may stay unreadable before a warning.
const unreadableAfter = 5 * time.Minute

// Watcher reads the books on every tick. Its state lives in one goroutine.
type Watcher struct {
	cfg        Config
	db         *sql.DB
	node       node
	client     *http.Client
	attempts   int
	retryDelay time.Duration
	pause      func(context.Context, time.Duration) error
	now        func() time.Time

	deficits      map[string]int
	active        map[string]bool
	unstableSince map[string]time.Time
	warned        map[string]bool
}

// New checks the configuration and builds a watcher.
func New(db *sql.DB, cfg Config) (*Watcher, error) {
	switch {
	case cfg.RPCURL == "":
		return nil, errors.New("launchpad watcher: no RPC URL")
	case cfg.ChainID == "":
		return nil, errors.New("launchpad watcher: no chain id")
	case cfg.WebhookURL == "":
		return nil, errors.New("launchpad watcher: no webhook URL, so it could not page anyone")
	case cfg.InjectBalanceOffset != 0 && cfg.ChainID != rehearsalChain:
		return nil, fmt.Errorf("launchpad watcher: an injected balance offset runs on %s only", rehearsalChain)
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Minute
	}
	return &Watcher{
		cfg: cfg, db: db, node: newNode(cfg.RPCURL), client: &http.Client{Timeout: 10 * time.Second},
		attempts: 5, retryDelay: 3 * time.Second, pause: sleep, now: time.Now,
		deficits: map[string]int{}, active: map[string]bool{}, unstableSince: map[string]time.Time{}, warned: map[string]bool{},
	}, nil
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Run reads every realm now and then on every interval, until ctx ends.
func (w *Watcher) Run(ctx context.Context) {
	slog.Info("launchpad watcher started", "chain", w.cfg.ChainID, "rpc", w.cfg.RPCURL, "interval", w.cfg.Interval)
	// The staleness rule needs a series before the first stable reading, so a
	// watcher that never reads one still alerts 15 minutes after it started.
	for _, l := range w.legs() {
		metrics.LaunchpadLastStableReading.WithLabelValues(l.realm).Set(float64(w.now().Unix()))
	}
	t := time.NewTicker(w.cfg.Interval)
	defer t.Stop()
	for {
		w.tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (w *Watcher) tick(ctx context.Context) {
	for _, l := range w.legs() {
		w.check(ctx, l)
	}
}

func (w *Watcher) check(ctx context.Context, l leg) {
	r, err := l.read(w, ctx)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		w.unreadable(l.realm, err)
		return
	}
	st, known, err := w.stored(l.realm)
	if err != nil {
		slog.Error("launchpad watcher: stored state unreadable", "realm", l.realm, "error", err)
		return
	}
	// A node whose height has not passed the last stable reading's (kept across
	// restarts) is stuck or behind: its books are not news.
	if known && r.height <= st.height {
		w.unreadable(l.realm, fmt.Errorf("node height %d has not passed the last stable reading's %d", r.height, st.height))
		return
	}
	delete(w.unstableSince, l.realm)
	delete(w.warned, l.realm)
	metrics.LaunchpadReadingStable.WithLabelValues(l.realm).Set(1)
	metrics.LaunchpadLastStableReading.WithLabelValues(l.realm).Set(float64(w.now().Unix()))
	if r.problem != "" {
		w.raise(r, "view", r.problem, nil)
		return
	}
	w.clear(r.realm, "view")
	if w.cfg.InjectBalanceOffset != 0 {
		r.balance = new(big.Int).Add(r.balance, big.NewInt(w.cfg.InjectBalanceOffset))
		r.fields += fmt.Sprintf(" (balance offset %d injected)", w.cfg.InjectBalanceOffset)
	}
	w.export(r)
	w.evaluate(r, st, known)
}

// unreadable records a reading that never held still, failed, or came from
// another chain. It warns once the books stay unreadable; it never pages.
func (w *Watcher) unreadable(realm string, err error) {
	metrics.LaunchpadReadingStable.WithLabelValues(realm).Set(0)
	if errors.Is(err, errWrongChain) {
		slog.Warn("launchpad watcher: wrong chain, reading skipped", "realm", realm, "error", err)
	}
	since, ok := w.unstableSince[realm]
	if !ok {
		w.unstableSince[realm] = w.now()
		return
	}
	if w.now().Sub(since) >= unreadableAfter && !w.warned[realm] {
		w.warned[realm] = true
		slog.Warn("launchpad watcher: books unreadable", "realm", realm, "since", since, "error", err)
	}
}

func (w *Watcher) evaluate(r reading, st state, known bool) {
	surplus := new(big.Int).Sub(r.balance, r.owed)
	if r.balance.Cmp(r.owed) < 0 {
		w.deficits[r.realm]++
		if w.deficits[r.realm] >= 2 {
			w.raise(r, "deficit", fmt.Sprintf("balance %s is below owed %s on two stable readings", r.balance, r.owed), nil)
		}
	} else {
		w.deficits[r.realm] = 0
		w.clear(r.realm, "deficit")
	}
	next := state{surplus: surplus, height: r.height}
	if known {
		// A fall is money that left beyond what was owed, even if later readings
		// refill it: it stays pending, with the lowest surplus seen, and the
		// baseline stays put until its page is delivered.
		next.fellTo = st.fellTo
		if surplus.Cmp(st.surplus) < 0 && (next.fellTo == nil || surplus.Cmp(next.fellTo) < 0) {
			next.fellTo = surplus
		}
		switch {
		case next.fellTo != nil:
			metrics.LaunchpadAlert.WithLabelValues(r.realm, "surplus_fell").Set(1)
			detail := fmt.Sprintf("surplus fell from %s to %s (now %s)", st.surplus, next.fellTo, surplus)
			if w.page(r, "surplus_fell", detail, st.surplus) {
				next.fellTo = nil
				metrics.LaunchpadAlert.WithLabelValues(r.realm, "surplus_fell").Set(0)
			} else {
				next.surplus = st.surplus
			}
		case surplus.Cmp(st.surplus) > 0:
			metrics.LaunchpadAlert.WithLabelValues(r.realm, "surplus_fell").Set(0)
			slog.Info("launchpad watcher: surplus rose (coins sent outside the entry points)", "realm", r.realm, "from", st.surplus, "to", surplus)
		default:
			metrics.LaunchpadAlert.WithLabelValues(r.realm, "surplus_fell").Set(0)
		}
	}
	if err := w.store(r.realm, next); err != nil {
		slog.Error("launchpad watcher: storing the reading failed", "realm", r.realm, "error", err)
	}
}

// raise pages a rule once when it starts to hold; clear ends it.
func (w *Watcher) raise(r reading, rule, detail string, previous *big.Int) {
	key := r.realm + " " + rule
	metrics.LaunchpadAlert.WithLabelValues(r.realm, rule).Set(1)
	if w.active[key] {
		return
	}
	w.active[key] = w.page(r, rule, detail, previous)
}

func (w *Watcher) clear(realm, rule string) {
	key := realm + " " + rule
	metrics.LaunchpadAlert.WithLabelValues(realm, rule).Set(0)
	if w.active[key] {
		delete(w.active, key)
		slog.Info("launchpad watcher: rule no longer holds", "realm", realm, "rule", rule)
	}
}

// page posts the alert to the webhook and reports whether it was delivered.
func (w *Watcher) page(r reading, rule, detail string, previous *big.Int) bool {
	stored := "none"
	if previous != nil {
		stored = previous.String()
	} else if st, ok, err := w.stored(r.realm); err == nil && ok {
		stored = st.surplus.String()
	}
	msg := fmt.Sprintf("LAUNCHPAD PAGE %s: %s\nchain %s, height %d, realm %s\nreading: %s\nprevious surplus: %s\nrpc: %s\naction: the pauser pauses the lane (config/v1.Pause %s); exits keep working.",
		rule, detail, w.cfg.ChainID, r.height, r.realm, r.fields, stored, w.cfg.RPCURL, lane(r.realm))
	slog.Error("launchpad watcher: page", "rule", rule, "realm", r.realm, "height", r.height, "detail", detail)
	if err := Notify(w.client, w.cfg.WebhookURL, msg); err != nil {
		slog.Error("launchpad watcher: page not delivered", "error", err)
		return false
	}
	return true
}

// Notify posts a message to a Discord or Telegram webhook: the body carries
// both "content" (Discord) and "text" (Telegram). The URL holds the secret
// (Telegram's bot token), so an error names its host only.
func Notify(client *http.Client, webhookURL, msg string) error {
	host := "webhook"
	if u, err := url.Parse(webhookURL); err == nil && u.Host != "" {
		host = u.Host
	}
	body, _ := json.Marshal(map[string]string{"content": msg, "text": msg})
	resp, err := client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("%s: %w", host, err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s answered %s", host, resp.Status)
	}
	return nil
}

func lane(realm string) string {
	if realm == marketRealm {
		return "nft_market"
	}
	return "fairsale"
}

func (w *Watcher) export(r reading) {
	metrics.LaunchpadBalance.WithLabelValues(r.realm).Set(toFloat(r.balance))
	metrics.LaunchpadSurplus.WithLabelValues(r.realm).Set(toFloat(new(big.Int).Sub(r.balance, r.owed)))
	for liability, v := range r.liabilities {
		metrics.LaunchpadOwed.WithLabelValues(r.realm, liability).Set(toFloat(v))
	}
}

// toFloat is for metrics only; every rule compares the exact integers.
func toFloat(v *big.Int) float64 {
	f, _ := new(big.Float).SetInt(v).Float64()
	return f
}

// state is a realm's row: the baseline surplus, the last stable reading's
// height and, while a fall is not yet paged, the lowest surplus it reached.
type state struct {
	surplus *big.Int
	height  int64
	fellTo  *big.Int
}

func (w *Watcher) stored(realm string) (state, bool, error) {
	var surplus string
	var fellTo sql.NullString
	var st state
	err := w.db.QueryRow(`SELECT surplus, height, fell_to FROM launchpad_watch_surplus WHERE chain_id = ? AND realm = ? AND currency = ?`,
		w.cfg.ChainID, realm, denom).Scan(&surplus, &st.height, &fellTo)
	if errors.Is(err, sql.ErrNoRows) {
		return state{}, false, nil
	}
	if err != nil {
		return state{}, false, err
	}
	// A surplus can be negative: it is stored as the books showed it.
	var ok bool
	if st.surplus, ok = new(big.Int).SetString(surplus, 10); !ok {
		return state{}, false, fmt.Errorf("stored surplus %.40q is not an integer", surplus)
	}
	if fellTo.Valid {
		if st.fellTo, ok = new(big.Int).SetString(fellTo.String, 10); !ok {
			return state{}, false, fmt.Errorf("stored fall %.40q is not an integer", fellTo.String)
		}
	}
	return st, true, nil
}

func (w *Watcher) store(realm string, st state) error {
	var fellTo sql.NullString
	if st.fellTo != nil {
		fellTo = sql.NullString{String: st.fellTo.String(), Valid: true}
	}
	_, err := w.db.Exec(`INSERT INTO launchpad_watch_surplus (chain_id, realm, currency, surplus, height, fell_to, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (chain_id, realm, currency) DO UPDATE SET surplus = excluded.surplus, height = excluded.height, fell_to = excluded.fell_to, updated_at = excluded.updated_at`,
		w.cfg.ChainID, realm, denom, st.surplus.String(), st.height, fellTo, w.now().Unix())
	return err
}

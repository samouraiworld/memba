package arcade

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// All limits require operator approval. Counters cover every game and realm
// sharing this chain/signer/database, and represent allowance, not actual spend.
type FreePlayBudgetSettings struct {
	Signer          string
	MaxAttempts     int64
	MaxFeeUgnot     int64
	MaxDepositUgnot int64
}
type FreePlayBudget struct {
	store    *FreePlayStore
	settings FreePlayBudgetSettings
	now      func() time.Time
}

func NewFreePlayBudget(store *FreePlayStore, settings FreePlayBudgetSettings, now func() time.Time) (*FreePlayBudget, error) {
	a, err := address.Parse(settings.Signer)
	if store == nil || store.db == nil || err != nil || a.Kind() != address.KindGno || a.String() != settings.Signer || settings.MaxAttempts <= 0 || settings.MaxAttempts > FreePlayMaxScore || settings.MaxFeeUgnot <= 0 || settings.MaxFeeUgnot > FreePlayMaxScore || settings.MaxDepositUgnot <= 0 || settings.MaxDepositUgnot > FreePlayMaxScore {
		return nil, ErrFreePlayPaused
	}
	if now == nil {
		now = time.Now
	}
	return &FreePlayBudget{store, settings, now}, nil
}
func (b *FreePlayBudget) validate(run FreePlayRun, q FreePlayQuote, now time.Time) error {
	if run.Target != b.store.target || run.Entry.Validate() != nil || run.PayloadHash != run.Entry.PayloadHash(run.Target) || q.RunID != run.Entry.RunID || q.PayloadHash != run.PayloadHash || !fpHex64.MatchString(q.ID) || !fpHex64.MatchString(q.Nonce) || q.Payer != "studio" {
		return ErrFreePlayConflict
	}
	if q.ExpiresAt <= now.Unix() {
		return ErrFreePlayQuote
	}
	if q.MaxFeeUgnot <= 0 || q.MaxDepositUgnot <= 0 || q.MaxFeeUgnot > b.settings.MaxFeeUgnot || q.MaxDepositUgnot > b.settings.MaxDepositUgnot {
		return ErrFreePlayBudget
	}
	return nil
}

type freePlayBudgetRow struct{ attempts, fee, deposit, maxAttempts, maxFee, maxDeposit int64 }

func (b *FreePlayBudget) allows(r freePlayBudgetRow, q FreePlayQuote) bool {
	return r.maxAttempts == b.settings.MaxAttempts && r.maxFee == b.settings.MaxFeeUgnot && r.maxDeposit == b.settings.MaxDepositUgnot && r.attempts >= 0 && r.fee >= 0 && r.deposit >= 0 && r.attempts < r.maxAttempts && r.fee <= r.maxFee-q.MaxFeeUgnot && r.deposit <= r.maxDeposit-q.MaxDepositUgnot
}

const freePlayBudgetSelect = `SELECT attempts,fee_ugnot,deposit_ugnot,max_attempts,max_fee_ugnot,max_deposit_ugnot FROM arcade_freeplay_budget_v2 WHERE chain_id=? AND signer=? AND day_utc=?`

func scanFreePlayBudget(row *sql.Row) (freePlayBudgetRow, error) {
	var r freePlayBudgetRow
	err := row.Scan(&r.attempts, &r.fee, &r.deposit, &r.maxAttempts, &r.maxFee, &r.maxDeposit)
	return r, err
}

// CanQuote is advisory and read-only. It cannot promise capacity to an issued
// quote; ReserveAttempt is the authoritative atomic check after user consent.
func (b *FreePlayBudget) CanQuote(ctx context.Context, run FreePlayRun, q FreePlayQuote) error {
	now := b.now()
	if err := b.validate(run, q, now); err != nil {
		return err
	}
	stored, err := b.store.Get(ctx, run.Entry.RunID)
	if err != nil {
		return err
	}
	if stored.Entry != run.Entry || stored.PayloadHash != run.PayloadHash {
		return ErrFreePlayConflict
	}
	row, err := scanFreePlayBudget(b.store.db.QueryRowContext(ctx, freePlayBudgetSelect, run.Target.ChainID, b.settings.Signer, now.UTC().Format("2006-01-02")))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && !b.allows(row, q) {
		return ErrFreePlayBudget
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return b.validate(run, q, b.now())
}

// FreePlayBudgetSpending joins one immutable cost policy to one durable budget.
// It does not run migrations, sign, refund or start a publisher.
type FreePlayBudgetSpending struct {
	budget *FreePlayBudget
	cost   *FreePlayCostPolicy
}

func NewFreePlayBudgetSpending(budget *FreePlayBudget, cost *FreePlayCostPolicy) (*FreePlayBudgetSpending, error) {
	if budget == nil || cost == nil || budget.store.target != cost.settings.Target || cost.settings.MaxFeeUgnot > budget.settings.MaxFeeUgnot || cost.settings.MaxDepositUgnot > budget.settings.MaxDepositUgnot {
		return nil, ErrFreePlayPaused
	}
	return &FreePlayBudgetSpending{budget, cost}, nil
}
func (s *FreePlayBudgetSpending) ReserveAttempt(ctx context.Context, run FreePlayRun, q FreePlayQuote) error {
	if err := s.cost.ValidateBroadcast(ctx, run.Target, run.Entry, q, s.cost.settings.GasWanted); err != nil {
		return err
	}
	return s.budget.reserve(ctx, run, q)
}

// The A2 spending port has no caller lease token. We verify matching live signer
// and outbox leases, while the publisher independently fences its own token
// before marking intent. A stale caller can conservatively consume allowance;
// it cannot gain permission to broadcast. No reservation is automatically freed.
func (b *FreePlayBudget) reserve(ctx context.Context, run FreePlayRun, q FreePlayQuote) error {
	if err := b.validate(run, q, b.now()); err != nil {
		return err
	}
	var identity [32]byte
	if _, err := rand.Read(identity[:]); err != nil {
		return err
	}
	tx, err := b.store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Acquire the actual SQLite writer, then read the clock and UTC bucket.
	if _, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_runs_v2 SET status=status WHERE run_id=?`, run.Entry.RunID); err != nil {
		return err
	}
	now := b.now()
	if err = b.validate(run, q, now); err != nil {
		return err
	}
	day := now.UTC().Format("2006-01-02")
	var raw, quoteRaw string
	err = tx.QueryRowContext(ctx, `SELECT r.record_json,q.quote_json
 FROM arcade_freeplay_runs_v2 r
 JOIN arcade_freeplay_outbox_v2 o ON o.run_id=r.run_id
 JOIN arcade_freeplay_quotes_v2 q ON q.quote_id=o.quote_id
 JOIN arcade_freeplay_signers_v2 s ON s.chain_id=r.chain_id AND s.signer=?
 WHERE r.run_id=? AND r.chain_id=? AND r.realm=? AND r.payload_hash=? AND r.status='queued'
 AND q.quote_id=? AND q.run_id=r.run_id AND q.payload_hash=r.payload_hash AND q.nonce=o.nonce AND q.nonce=? AND q.consumed=1 AND q.expires_at>?
 AND o.tx_hash='' AND o.broadcast_attempts=0 AND o.lease_owner<>'' AND o.lease_until>?
 AND s.lease_owner=o.lease_owner AND s.lease_until>? AND (s.pending_run_id='' OR s.pending_run_id=r.run_id)`, b.settings.Signer, run.Entry.RunID, run.Target.ChainID, run.Target.Realm, run.PayloadHash, q.ID, q.Nonce, now.Unix(), now.Unix(), now.Unix()).Scan(&raw, &quoteRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrFreePlayConflict
	}
	if err != nil {
		return err
	}
	var stored FreePlayRun
	var storedQuote FreePlayQuote
	if json.Unmarshal([]byte(raw), &stored) != nil || json.Unmarshal([]byte(quoteRaw), &storedQuote) != nil || stored.Target != run.Target || stored.Entry != run.Entry || stored.PayloadHash != run.PayloadHash || storedQuote != q {
		return ErrFreePlayConflict
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO arcade_freeplay_budget_v2(chain_id,signer,day_utc,max_attempts,max_fee_ugnot,max_deposit_ugnot) VALUES(?,?,?,?,?,?) ON CONFLICT(chain_id,signer,day_utc) DO NOTHING`, run.Target.ChainID, b.settings.Signer, day, b.settings.MaxAttempts, b.settings.MaxFeeUgnot, b.settings.MaxDepositUgnot)
	if err != nil {
		return err
	}
	row, err := scanFreePlayBudget(tx.QueryRowContext(ctx, freePlayBudgetSelect, run.Target.ChainID, b.settings.Signer, day))
	if err != nil {
		return err
	}
	if !b.allows(row, q) {
		return ErrFreePlayBudget
	}
	// Subtraction checks above make additions safe even near the JSON integer cap.
	_, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_budget_v2 SET attempts=attempts+1,fee_ugnot=fee_ugnot+?,deposit_ugnot=deposit_ugnot+? WHERE chain_id=? AND signer=? AND day_utc=?`, q.MaxFeeUgnot, q.MaxDepositUgnot, run.Target.ChainID, b.settings.Signer, day)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO arcade_freeplay_spending_v2(reservation_id,chain_id,signer,day_utc,run_id,quote_id,fee_ugnot,deposit_ugnot,created_at) VALUES(?,?,?,?,?,?,?,?,?)`, hex.EncodeToString(identity[:]), run.Target.ChainID, b.settings.Signer, day, run.Entry.RunID, q.ID, q.MaxFeeUgnot, q.MaxDepositUgnot, now.Unix())
	if err != nil {
		return err
	}
	// If local work crosses midnight, fail closed instead of charging yesterday.
	finalNow := b.now()
	if err = b.validate(run, q, finalNow); err != nil {
		return err
	}
	if finalNow.UTC().Format("2006-01-02") != day {
		return ErrFreePlayBudget
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	// Commit may cross expiry. The caller must recheck authorization afterwards;
	// the A2 publisher does. Persisted allowance remains charged conservatively.
	return tx.Commit()
}

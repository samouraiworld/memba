package arcade

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/samouraiworld/memba/backend/internal/address"
)

type FreePlayStore struct {
	db     *sql.DB
	target FreePlayTarget
}

func NewFreePlayStore(db *sql.DB, target FreePlayTarget) (*FreePlayStore, error) {
	if db == nil {
		return nil, errors.New("missing_database")
	}
	if err := target.Validate(); err != nil {
		return nil, err
	}
	return &FreePlayStore{db: db, target: target}, nil
}
func (s *FreePlayStore) Get(ctx context.Context, id string) (FreePlayRun, error) {
	var raw, status string
	var receipt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT record_json,status,receipt_json FROM arcade_freeplay_runs_v2 WHERE run_id=? AND chain_id=? AND realm=?`, id, s.target.ChainID, s.target.Realm).Scan(&raw, &status, &receipt)
	if errors.Is(err, sql.ErrNoRows) {
		return FreePlayRun{}, ErrFreePlayMissing
	}
	if err != nil {
		return FreePlayRun{}, err
	}
	var run FreePlayRun
	if err = json.Unmarshal([]byte(raw), &run); err != nil {
		return run, err
	}
	run.Status = status
	if err := s.db.QueryRowContext(ctx, `SELECT broadcast_attempts,operational_failures,confirmation_polls,next_check_at,last_error FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, id).Scan(&run.BroadcastAttempts, &run.OperationalFailures, &run.ConfirmationPolls, &run.NextCheckAt, &run.LastError); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return FreePlayRun{}, err
	}
	if run.OperationalFailures >= 8 && status == "queued" {
		run.LastError = "retry_limit_operator_review_required"
	}

	if status == "submitted" && run.LastError == "" {
		run.LastError = "confirmation_pending"
	}
	if receipt.Valid {
		run.Receipt = &FreePlayReceipt{}
		if err = json.Unmarshal([]byte(receipt.String), run.Receipt); err != nil {
			return FreePlayRun{}, err
		}
	}
	return run, nil
}
func (s *FreePlayStore) PutVerified(ctx context.Context, run FreePlayRun, now int64) (FreePlayRun, error) {
	if run.Target != s.target || run.Status != "verified" || run.Receipt != nil {
		return FreePlayRun{}, ErrFreePlayConflict
	}
	if err := run.Entry.Validate(); err != nil {
		return FreePlayRun{}, err
	}
	id, err := FreePlayRunID(run.Target, run.Entry.Player, run.Entry.Game, run.ClientRunID)
	if err != nil || id != run.Entry.RunID || run.PayloadHash != run.Entry.PayloadHash(run.Target) {
		return FreePlayRun{}, ErrFreePlayConflict
	}
	raw, err := json.Marshal(run)
	if err != nil {
		return FreePlayRun{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO arcade_freeplay_runs_v2(run_id,chain_id,realm,player,game,client_run_id,payload_hash,record_json,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'verified',?) ON CONFLICT(run_id) DO NOTHING`, id, s.target.ChainID, s.target.Realm, run.Entry.Player, run.Entry.Game, run.ClientRunID, run.PayloadHash, string(raw), now)
	if err != nil {
		return FreePlayRun{}, err
	}
	got, err := s.Get(ctx, id)
	if err != nil {
		return FreePlayRun{}, err
	}
	if got.PayloadHash != run.PayloadHash || got.ReplayCodec != run.ReplayCodec || got.Replay != run.Replay {
		return FreePlayRun{}, ErrFreePlayConflict
	}
	return got, nil
}

// Quote is authored by a trusted spending policy, never accepted from the body.
// Only studio-paid preparation is supported; player payment needs a separate
// reviewed receipt/payment protocol before it can enqueue anything.
type FreePlayQuote struct {
	ID              string `json:"quoteId"`
	RunID           string `json:"runID"`
	PayloadHash     string `json:"payloadHash"`
	Nonce           string `json:"nonce"`
	ExpiresAt       int64  `json:"expiresAt"`
	Payer           string `json:"payer"`
	MaxFeeUgnot     int64  `json:"maxFeeUgnot"`
	MaxDepositUgnot int64  `json:"maxDepositUgnot"`
}

func (s *FreePlayStore) PutQuote(ctx context.Context, q FreePlayQuote, now int64) error {
	if !fpHex64.MatchString(q.ID) || !fpHex64.MatchString(q.Nonce) || q.Payer != "studio" || q.ExpiresAt <= now || q.MaxFeeUgnot <= 0 || q.MaxDepositUgnot <= 0 {
		return ErrFreePlayPaused
	}
	run, err := s.Get(ctx, q.RunID)
	if err != nil {
		return err
	}
	if run.PayloadHash != q.PayloadHash {
		return ErrFreePlayConflict
	}
	raw, err := json.Marshal(q)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO arcade_freeplay_quotes_v2(quote_id,run_id,payload_hash,nonce,expires_at,quote_json) VALUES(?,?,?,?,?,?)`, q.ID, q.RunID, q.PayloadHash, q.Nonce, q.ExpiresAt, string(raw))
	return err
}
func (s *FreePlayStore) Queue(ctx context.Context, id, player, payload, quoteID, nonce string, now int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Acquire the SQLite writer before reading: concurrent deferred readers
	// otherwise fail upgrading their snapshots (SQLITE_BUSY) on exact retries.
	if _, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_runs_v2 SET status=status WHERE run_id=? AND player=? AND chain_id=? AND realm=?`, id, player, s.target.ChainID, s.target.Realm); err != nil {
		return err
	}
	var stored, status string
	err = tx.QueryRowContext(ctx, `SELECT payload_hash,status FROM arcade_freeplay_runs_v2 WHERE run_id=? AND player=? AND chain_id=? AND realm=?`, id, player, s.target.ChainID, s.target.Realm).Scan(&stored, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrFreePlayMissing
	}
	if err != nil {
		return err
	}
	if stored != payload {
		return ErrFreePlayConflict
	}
	// Exact retries recover their original authorization. Replacing it requires
	// proof under this writer transaction that no broadcast was ever reserved.
	var oldQuote, oldNonce, txHash string
	var attempts int
	var leaseUntil, expiresAt int64
	replace := false
	err = tx.QueryRowContext(ctx, `SELECT o.quote_id,o.nonce,o.tx_hash,o.broadcast_attempts,o.lease_until,q.expires_at
 FROM arcade_freeplay_outbox_v2 o JOIN arcade_freeplay_quotes_v2 q ON q.quote_id=o.quote_id WHERE o.run_id=?`, id).Scan(&oldQuote, &oldNonce, &txHash, &attempts, &leaseUntil, &expiresAt)
	if err == nil {
		if oldQuote == quoteID && oldNonce == nonce {
			return tx.Commit()
		}
		if status != "queued" || txHash != "" || attempts != 0 || leaseUntil > now || expiresAt > now {
			return ErrFreePlayConflict
		}
		replace = true
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if status != "verified" && !replace {
		return ErrFreePlayConflict
	}
	res, err := tx.ExecContext(ctx, `UPDATE arcade_freeplay_quotes_v2 SET consumed=1 WHERE quote_id=? AND run_id=? AND payload_hash=? AND nonce=? AND expires_at>? AND consumed=0`, quoteID, id, payload, nonce, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrFreePlayQuote
	}
	if replace {
		// Clear the owner token, fencing any expired worker before it can reserve
		// a broadcast. Never clear an ambiguous marker or reset sent attempts.
		_, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET quote_id=?,nonce=?,lease_owner='',lease_until=0,operational_failures=0,confirmation_polls=0,next_check_at=0,last_error='' WHERE run_id=?`, quoteID, nonce, id)
	} else {
		_, err = tx.ExecContext(ctx, `INSERT INTO arcade_freeplay_outbox_v2(run_id,quote_id,nonce) VALUES(?,?,?)`, id, quoteID, nonce)
	}
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_runs_v2 SET status='queued' WHERE run_id=?`, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// ReauthorizationAllowed is an informational view. Queue rechecks the same
// conditions atomically when explicit consent consumes the new quote.
func (s *FreePlayStore) ReauthorizationAllowed(ctx context.Context, id string, now int64) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM arcade_freeplay_runs_v2 r
 JOIN arcade_freeplay_outbox_v2 o ON o.run_id=r.run_id JOIN arcade_freeplay_quotes_v2 q ON q.quote_id=o.quote_id
 WHERE r.run_id=? AND r.chain_id=? AND r.realm=? AND r.status='queued'
 AND o.tx_hash='' AND o.broadcast_attempts=0 AND o.lease_until<=? AND q.expires_at<=?`, id, s.target.ChainID, s.target.Realm, now, now).Scan(&count)
	return count == 1, err
}

// Lease owns one bounded operation, not a broadcast attempt. Its token fences late workers; an expired
// worker cannot save receipts over the owner of a newer lease.
type FreePlayLease struct {
	Signer              string
	Run                 FreePlayRun
	Quote               FreePlayQuote
	Owner               string
	TxHash              string
	OperationalFailures int
	ConfirmationPolls   int
}

func (s *FreePlayStore) Claim(ctx context.Context, signer, owner string, now, until int64) (FreePlayLease, bool, error) {
	a, err := address.Parse(signer)
	if err != nil || a.Kind() != address.KindGno || a.String() != signer || !fpHex64.MatchString(owner) || until <= now {
		return FreePlayLease{}, false, errors.New("invalid_lease")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FreePlayLease{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	// This is the first statement: obtain SQLite's writer before any reads.
	res, err := tx.ExecContext(ctx, `INSERT INTO arcade_freeplay_signers_v2(chain_id,signer,lease_owner,lease_until) VALUES(?,?,?,?)
 ON CONFLICT(chain_id,signer) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until
 WHERE arcade_freeplay_signers_v2.lease_until<=?`, s.target.ChainID, signer, owner, until, now)
	if err != nil {
		return FreePlayLease{}, false, err
	}
	n, err := res.RowsAffected()
	if err != nil || n == 0 {
		return FreePlayLease{}, false, err
	}
	var pending string
	if err = tx.QueryRowContext(ctx, `SELECT pending_run_id FROM arcade_freeplay_signers_v2 WHERE chain_id=? AND signer=?`, s.target.ChainID, signer).Scan(&pending); err != nil {
		return FreePlayLease{}, false, err
	}
	res, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET lease_owner=?,lease_until=? WHERE run_id=(
 SELECT o.run_id FROM arcade_freeplay_outbox_v2 o JOIN arcade_freeplay_runs_v2 r ON r.run_id=o.run_id
 WHERE r.chain_id=? AND r.realm=? AND r.status IN ('queued','submitted') AND o.lease_until<=? AND o.next_check_at<=? AND (o.tx_hash!='' OR o.operational_failures<8)
 AND (?='' OR o.run_id=?)
 AND NOT EXISTS(SELECT 1 FROM arcade_freeplay_outbox_v2 used WHERE used.lease_owner=?)
 ORDER BY CASE WHEN r.status='submitted' THEN 0 ELSE 1 END,r.created_at,r.run_id LIMIT 1)`, owner, until, s.target.ChainID, s.target.Realm, now, now, pending, pending, owner)
	if err != nil {
		return FreePlayLease{}, false, err
	}
	n, err = res.RowsAffected()
	if err != nil || n == 0 {
		return FreePlayLease{}, false, err
	}
	var id, raw string
	l := FreePlayLease{Signer: signer, Owner: owner}
	err = tx.QueryRowContext(ctx, `SELECT o.run_id,o.tx_hash,o.operational_failures,o.confirmation_polls,q.quote_json FROM arcade_freeplay_outbox_v2 o JOIN arcade_freeplay_quotes_v2 q ON q.quote_id=o.quote_id WHERE o.lease_owner=?`, owner).Scan(&id, &l.TxHash, &l.OperationalFailures, &l.ConfirmationPolls, &raw)
	if err != nil {
		return l, false, err
	}
	if err = json.Unmarshal([]byte(raw), &l.Quote); err != nil {
		return l, false, err
	}
	if err = tx.Commit(); err != nil {
		return l, false, err
	}
	l.Run, err = s.Get(ctx, id)
	return l, err == nil, err
}

// reserveBroadcast commits the ambiguous-outcome marker BEFORE network I/O.
// A process death after this commit cannot cause an automatic second spend.
func (s *FreePlayStore) reserveBroadcast(ctx context.Context, l FreePlayLease) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `UPDATE arcade_freeplay_signers_v2 SET pending_run_id=? WHERE chain_id=? AND signer=? AND lease_owner=? AND (pending_run_id='' OR pending_run_id=?)`, l.Run.Entry.RunID, s.target.ChainID, l.Signer, l.Owner, l.Run.Entry.RunID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("signer_lease_lost")
	}
	res, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET tx_hash='unknown',broadcast_attempts=broadcast_attempts+1 WHERE run_id=? AND lease_owner=? AND tx_hash=''`, l.Run.Entry.RunID, l.Owner)
	if err != nil {
		return err
	}
	n, err = res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("lease_lost")
	}
	_, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_runs_v2 SET status='submitted' WHERE run_id=? AND status='queued'`, l.Run.Entry.RunID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// saveBroadcastHash retains the account lease until the immediate readback.
func (s *FreePlayStore) saveBroadcastHash(ctx context.Context, l FreePlayLease, hash string) error {
	if !fpHex64.MatchString(hash) {
		return errors.New("invalid_transaction_hash")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET tx_hash=? WHERE run_id=? AND lease_owner=? AND tx_hash='unknown'`, hash, l.Run.Entry.RunID, l.Owner)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("lease_lost")
	}
	return nil
}

func freePlayCheckDelay(previous int) int64 {
	delays := [...]int64{5, 10, 20, 40, 80, 160, 300}
	return delays[min(max(previous, 0), len(delays)-1)]
}

// saveAttempt records either a pre-send operational failure or a pending
// confirmation read. Only the former has a finite retry budget. Both persist
// their next eligible time so even a tight caller loop cannot poll the RPC.
func (s *FreePlayStore) saveAttempt(ctx context.Context, l FreePlayLease, txHash string, failure error, now int64) error {
	message := ""
	if failure != nil {
		message = failure.Error()
		if len(message) > 256 {
			message = message[:256]
		}
	}
	pending := l.TxHash != "" || txHash != ""
	previous := l.OperationalFailures
	if pending {
		previous = l.ConfirmationPolls
	}
	next := now + freePlayCheckDelay(previous)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET
 tx_hash=CASE WHEN ?='' THEN tx_hash ELSE ? END,
 confirmation_polls=confirmation_polls+CASE WHEN tx_hash!='' OR ?!='' THEN 1 ELSE 0 END,
 operational_failures=operational_failures+CASE WHEN tx_hash='' AND ?='' THEN 1 ELSE 0 END,
 next_check_at=?,last_error=?,lease_until=0 WHERE run_id=? AND lease_owner=?`,
		txHash, txHash, txHash, txHash, next, message, l.Run.Entry.RunID, l.Owner)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("lease_lost")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_signers_v2 SET lease_until=0 WHERE chain_id=? AND signer=? AND lease_owner=?`, s.target.ChainID, l.Signer, l.Owner); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *FreePlayStore) confirm(ctx context.Context, l FreePlayLease, receipt FreePlayReceipt) error {
	if err := ValidateFreePlayReceipt(l.Run, receipt); err != nil {
		return err
	}
	raw, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `UPDATE arcade_freeplay_runs_v2 SET status='confirmed',receipt_json=? WHERE run_id=? AND EXISTS(SELECT 1 FROM arcade_freeplay_outbox_v2 WHERE run_id=? AND lease_owner=?)`, string(raw), l.Run.Entry.RunID, l.Run.Entry.RunID, l.Owner)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("lease_lost")
	}
	_, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_outbox_v2 SET lease_until=0,last_error='',next_check_at=0 WHERE run_id=? AND lease_owner=?`, l.Run.Entry.RunID, l.Owner)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE arcade_freeplay_signers_v2 SET lease_until=0,pending_run_id='' WHERE chain_id=? AND signer=? AND lease_owner=? AND (pending_run_id='' OR pending_run_id=?)`, s.target.ChainID, l.Signer, l.Owner, l.Run.Entry.RunID); err != nil {
		return err
	}
	return tx.Commit()
}

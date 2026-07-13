package arcade

import (
	"database/sql"
	"errors"
	"strings"
)

// ErrDuplicateLog is returned when a run with the same input-log hash already
// exists — the backend's replay-theft guard (a log binds to its first submitter,
// mirroring the realm's global hashOwners net).
var ErrDuplicateLog = errors.New("arcade: input log already submitted")

// Run is one stored, verified submission. The events (input log) are retained
// for day-close publication and re-verification.
type Run struct {
	LogHash        string
	Addr           string
	Day            string
	Mode           string
	Seed           string
	SimVersion     int64
	Score          int64
	Waves          int64
	Won            bool
	OvertimeRound  int64
	StateHash      string
	Events         string
	Status         string
	AttestedTxHash string
	CreatedAt      int64
	AttestedAt     int64
}

// Store is the arcade_runs data access layer (a thin package of query functions
// over the shared sqlite handle, following the internal/blockparty pattern).
type Store struct{ db *sql.DB }

// NewStore wraps a database handle.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// DB exposes the underlying handle (used by the day-close batcher's ranked
// queries and by tests).
func (s *Store) DB() *sql.DB { return s.db }

// InsertRun persists a verified run. A duplicate input-log hash returns
// ErrDuplicateLog (the row is NOT overwritten — first submitter wins).
func (s *Store) InsertRun(r Run) error {
	_, err := s.db.Exec(
		`INSERT INTO arcade_runs
			(input_log_sha256, addr, day, mode, seed, sim_version, score, waves, won,
			 overtime_round, state_hash, events, status, attested_txhash, created_at, attested_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.LogHash, r.Addr, r.Day, r.Mode, r.Seed, r.SimVersion, r.Score, r.Waves, boolToInt(r.Won),
		r.OvertimeRound, r.StateHash, r.Events, statusOrDefault(r.Status), nullIfEmpty(r.AttestedTxHash),
		r.CreatedAt, nullIfZero(r.AttestedAt),
	)
	if err != nil && isUniqueViolation(err) {
		return ErrDuplicateLog
	}
	return err
}

// PendingDailyDays returns the distinct CLOSED days (day < beforeDay, typically
// today UTC) that still hold a verified-but-unattested competitive daily run,
// ascending — the day-close batcher's work list.
func (s *Store) PendingDailyDays(beforeDay string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT DISTINCT day FROM arcade_runs
		 WHERE mode = 'daily' AND status = 'verified' AND day < ?
		 ORDER BY day`, beforeDay)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var days []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	return days, rows.Err()
}

// BestVerifiedDaily returns a day's competitive board to attest: the BEST
// verified-but-unattested run per address (score desc, total-order tiebreak).
// One row per address, because the realm's board is one-entry-per-address-per-day
// and AttestScore PANICS on a non-improving re-attest — so the backend must never
// attest a wallet's worse run after its better one.
func (s *Store) BestVerifiedDaily(day string, limit int) ([]Run, error) {
	if limit <= 0 {
		limit = 500
	}
	// The correlated subquery picks each address's max verified score for the day;
	// GROUP BY addr collapses ties (same addr, same score, different logs) to one.
	rows, err := s.db.Query(
		`SELECT input_log_sha256, addr, day, mode, seed, sim_version, score, waves, won,
			 overtime_round, state_hash, events, status,
			 COALESCE(attested_txhash, ''), created_at, COALESCE(attested_at, 0)
		 FROM arcade_runs r
		 WHERE day = ? AND mode = 'daily' AND status = 'verified'
		   AND score = (SELECT MAX(score) FROM arcade_runs r2
		                WHERE r2.addr = r.addr AND r2.day = r.day
		                  AND r2.mode = 'daily' AND r2.status = 'verified')
		 GROUP BY addr
		 ORDER BY score DESC, created_at ASC, input_log_sha256 ASC
		 LIMIT ?`, day, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Run
	for rows.Next() {
		r, _, serr := scanRun(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MarkAttested flips a run to 'attested' and records the attestation tx. Idempotent
// on repeat (the "don't re-attest" guard is the verified-status filter in the
// selection queries, not this write).
func (s *Store) MarkAttested(logHash, txHash string, at int64) error {
	_, err := s.db.Exec(
		`UPDATE arcade_runs SET status = 'attested', attested_txhash = ?, attested_at = ?
		 WHERE input_log_sha256 = ?`, txHash, at, logHash)
	return err
}

// MarkSkipped retires a single run ('skipped') without attesting it — used when
// a run can never be attested (its log is bound on-chain to another address) so
// it stops being retried every cycle.
func (s *Store) MarkSkipped(logHash string) error {
	_, err := s.db.Exec(
		`UPDATE arcade_runs SET status = 'skipped' WHERE input_log_sha256 = ? AND status = 'verified'`, logHash)
	return err
}

// ResolveSupersededDaily marks an address's OTHER verified daily runs for a day as
// 'skipped' once its best has been attested — so the below-best runs don't keep the
// day pending (and can't trigger the realm's non-improving panic). Called only
// after a successful attestation of keepLogHash.
func (s *Store) ResolveSupersededDaily(day, addr, keepLogHash string) error {
	_, err := s.db.Exec(
		`UPDATE arcade_runs SET status = 'skipped'
		 WHERE day = ? AND addr = ? AND mode = 'daily' AND status = 'verified'
		   AND input_log_sha256 != ?`, day, addr, keepLogHash)
	return err
}

// GetRunByLogHash returns the run for an input-log hash, or ok=false if none.
func (s *Store) GetRunByLogHash(logHash string) (Run, bool, error) {
	row := s.db.QueryRow(
		`SELECT input_log_sha256, addr, day, mode, seed, sim_version, score, waves, won,
			 overtime_round, state_hash, events, status,
			 COALESCE(attested_txhash, ''), created_at, COALESCE(attested_at, 0)
		 FROM arcade_runs WHERE input_log_sha256 = ?`, logHash)
	return scanRun(row)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanRun(row scanner) (Run, bool, error) {
	var r Run
	var won int64
	if err := row.Scan(
		&r.LogHash, &r.Addr, &r.Day, &r.Mode, &r.Seed, &r.SimVersion, &r.Score, &r.Waves, &won,
		&r.OvertimeRound, &r.StateHash, &r.Events, &r.Status, &r.AttestedTxHash, &r.CreatedAt, &r.AttestedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Run{}, false, nil
		}
		return Run{}, false, err
	}
	r.Won = won != 0
	return r, true, nil
}

func boolToInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func statusOrDefault(s string) string {
	if s == "" {
		return "verified"
	}
	return s
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullIfZero(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

// isUniqueViolation reports whether err is a sqlite UNIQUE constraint failure.
// modernc.org/sqlite surfaces it in the error text ("UNIQUE constraint failed").
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

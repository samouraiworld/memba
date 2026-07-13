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

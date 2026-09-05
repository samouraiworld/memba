package blockparty

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Challenge struct {
	Date     string
	Height   int64
	Hash     string
	Seed     uint32
	Modifier string
	Par      int64
}

func validateDate(date string) error {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || parsed.Format("2006-01-02") != date {
		return fmt.Errorf("invalid UTC date %q", date)
	}
	return nil
}

func validateChallenge(c Challenge) error {
	if err := validateDate(c.Date); err != nil {
		return err
	}
	if c.Height <= 0 || c.Hash == "" {
		return errors.New("challenge block provenance is incomplete")
	}
	if c.Modifier != "standard" && c.Modifier != "doubles" && c.Modifier != "rush" {
		return fmt.Errorf("invalid challenge modifier %q", c.Modifier)
	}
	if c.Par < 0 {
		return errors.New("challenge par must not be negative")
	}
	return nil
}

func PutChallenge(db *sql.DB, c Challenge) error {
	if err := validateChallenge(c); err != nil {
		return err
	}
	_, err := db.Exec(
		`INSERT OR IGNORE INTO blockparty_challenges (date, block_height, block_hash, seed, modifier, par)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.Date, c.Height, c.Hash, int64(c.Seed), c.Modifier, c.Par,
	)
	return err
}

func GetChallenge(db *sql.DB, date string) (Challenge, bool, error) {
	if err := validateDate(date); err != nil {
		return Challenge{}, false, err
	}
	var c Challenge
	var seed int64
	err := db.QueryRow(
		`SELECT date, block_height, block_hash, seed, modifier, par FROM blockparty_challenges WHERE date=?`, date,
	).Scan(&c.Date, &c.Height, &c.Hash, &seed, &c.Modifier, &c.Par)
	if err == sql.ErrNoRows {
		return Challenge{}, false, nil
	}
	if err != nil {
		return Challenge{}, false, err
	}
	if seed < 0 || seed > int64(^uint32(0)) {
		return Challenge{}, false, fmt.Errorf("stored challenge seed %d is outside uint32", seed)
	}
	c.Seed = uint32(seed) // #nosec G115 -- seed is persisted as int64(uint32) by PutChallenge; round-trips within uint32 range
	if err := validateChallenge(c); err != nil {
		return Challenge{}, false, fmt.Errorf("invalid stored challenge: %w", err)
	}
	return c, true, nil
}

func InsertScore(db *sql.DB, date, address string, score int64, moveLog, boardHash string) (bool, error) {
	if err := validateDate(date); err != nil {
		return false, err
	}
	if address == "" || score < 0 || boardHash == "" {
		return false, errors.New("score submission is incomplete")
	}
	res, err := db.Exec(
		`INSERT OR IGNORE INTO blockparty_scores (date, address, score, move_log, board_hash_final)
		 VALUES (?, ?, ?, ?, ?)`,
		date, address, score, moveLog, boardHash,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

type SubmittedScore struct {
	Score     int64
	MoveLog   string
	BoardHash string
}

// GetSubmittedScore supports idempotent delivery: an exact retry can recover
// the authoritative first-write result, while a different replay remains a
// conflict under the one-score-per-address-per-day contract.
func GetSubmittedScore(db *sql.DB, date, address string) (SubmittedScore, bool, error) {
	if err := validateDate(date); err != nil {
		return SubmittedScore{}, false, err
	}
	if address == "" {
		return SubmittedScore{}, false, errors.New("score address is empty")
	}
	var out SubmittedScore
	err := db.QueryRow(
		`SELECT score, move_log, board_hash_final FROM blockparty_scores WHERE date=? AND address=?`,
		date, address,
	).Scan(&out.Score, &out.MoveLog, &out.BoardHash)
	if errors.Is(err, sql.ErrNoRows) {
		return SubmittedScore{}, false, nil
	}
	if err != nil {
		return SubmittedScore{}, false, err
	}
	return out, true, nil
}

type ScoreRow struct {
	Address string
	Score   int64
}

func TopScores(db *sql.DB, date string, limit int) ([]ScoreRow, error) {
	if err := validateDate(date); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		return nil, fmt.Errorf("leaderboard limit %d is outside 1..100", limit)
	}
	rows, err := db.Query(
		`SELECT address, score FROM blockparty_scores WHERE date=? ORDER BY score DESC, created_at ASC, address ASC LIMIT ?`,
		date, limit,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []ScoreRow
	for rows.Next() {
		var r ScoreRow
		if err := rows.Scan(&r.Address, &r.Score); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Percentile = % of the day's submissions with a strictly lower score.
func Percentile(db *sql.DB, date string, score int64) (int, error) {
	if err := validateDate(date); err != nil {
		return 0, err
	}
	if score < 0 {
		return 0, errors.New("score must not be negative")
	}
	var total, below int
	if err := db.QueryRow(`SELECT COUNT(*) FROM blockparty_scores WHERE date=?`, date).Scan(&total); err != nil {
		return 0, err
	}
	if total == 0 {
		return 100, nil
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM blockparty_scores WHERE date=? AND score < ?`, date, score).Scan(&below); err != nil {
		return 0, err
	}
	return below * 100 / total, nil
}

type Streak struct {
	Current          int
	Longest          int
	FreezesRemaining int
	LastPlayed       string
	WeekAnchor       string
}

type queryRower interface {
	QueryRow(query string, args ...any) *sql.Row
}

func getStreak(q queryRower, address string) (Streak, error) {
	var s Streak
	var last, weekAnchor sql.NullString
	err := q.QueryRow(
		`SELECT current, longest, freezes_remaining, last_played_date, week_anchor FROM blockparty_streaks WHERE address=?`, address,
	).Scan(&s.Current, &s.Longest, &s.FreezesRemaining, &last, &weekAnchor)
	if err == sql.ErrNoRows {
		return Streak{FreezesRemaining: 1}, nil
	}
	if err != nil {
		return Streak{}, err
	}
	s.LastPlayed = last.String
	s.WeekAnchor = weekAnchor.String
	return s, nil
}

func GetStreak(db *sql.DB, address string) (Streak, error) {
	if address == "" {
		return Streak{}, errors.New("streak address is empty")
	}
	return getStreak(db, address)
}

// BumpStreak applies streak rules for a play on `date`:
//   - same date already played: no change
//   - consecutive day (date = last+1): current++
//   - exactly one missed day, a freeze available: freeze absorbs it, current++
//   - otherwise: reset to 1
//
// One freeze is refilled at the start of each new ISO week.
func BumpStreak(db *sql.DB, address, date string) (Streak, error) {
	if address == "" {
		return Streak{}, errors.New("streak address is empty")
	}
	if err := validateDate(date); err != nil {
		return Streak{}, err
	}
	today, _ := time.Parse("2006-01-02", date)
	tx, err := db.Begin()
	if err != nil {
		return Streak{}, err
	}
	defer func() { _ = tx.Rollback() }()
	s, err := getStreak(tx, address)
	if err != nil {
		return Streak{}, err
	}
	// weekly freeze refill
	wy, ww := today.ISOWeek()
	weekKey := isoWeekKey(wy, ww)
	freezes := s.FreezesRemaining
	if s.WeekAnchor != weekKey {
		freezes = 1
	}

	newCurrent := 1
	if s.LastPlayed != "" {
		last, parseErr := time.Parse("2006-01-02", s.LastPlayed)
		if parseErr != nil || last.Format("2006-01-02") != s.LastPlayed {
			return Streak{}, fmt.Errorf("invalid stored streak date %q", s.LastPlayed)
		}
		gap := int(today.Sub(last).Hours() / 24)
		switch {
		case gap < 0:
			return Streak{}, fmt.Errorf("streak date %s predates last played date %s", date, s.LastPlayed)
		case gap == 0:
			newCurrent = s.Current // already played today
		case gap == 1:
			newCurrent = s.Current + 1
		case gap == 2 && freezes > 0:
			newCurrent = s.Current + 1
			freezes--
		default:
			newCurrent = 1
		}
	}
	longest := s.Longest
	if newCurrent > longest {
		longest = newCurrent
	}
	_, err = tx.Exec(
		`INSERT INTO blockparty_streaks (address, current, longest, last_played_date, freezes_remaining, week_anchor, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(address) DO UPDATE SET current=excluded.current, longest=excluded.longest,
		   last_played_date=excluded.last_played_date, freezes_remaining=excluded.freezes_remaining,
		   week_anchor=excluded.week_anchor, updated_at=excluded.updated_at`,
		address, newCurrent, longest, date, freezes, weekKey, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return Streak{}, err
	}
	if err := tx.Commit(); err != nil {
		return Streak{}, err
	}
	return Streak{
		Current: newCurrent, Longest: longest, FreezesRemaining: freezes,
		LastPlayed: date, WeekAnchor: weekKey,
	}, nil
}

// isoWeekKey formats an ISO year+week as e.g. "2026-W28".
func isoWeekKey(year, week int) string {
	return fmt.Sprintf("%04d-W%02d", year, week)
}

package blockparty

import (
	"database/sql"
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

func PutChallenge(db *sql.DB, c Challenge) error {
	_, err := db.Exec(
		`INSERT OR IGNORE INTO blockparty_challenges (date, block_height, block_hash, seed, modifier, par)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.Date, c.Height, c.Hash, int64(c.Seed), c.Modifier, c.Par,
	)
	return err
}

func GetChallenge(db *sql.DB, date string) (Challenge, bool, error) {
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
	c.Seed = uint32(seed)
	return c, true, nil
}

func InsertScore(db *sql.DB, date, address string, score int64, moveLog, boardHash string) (bool, error) {
	res, err := db.Exec(
		`INSERT OR IGNORE INTO blockparty_scores (date, address, score, move_log, board_hash_final)
		 VALUES (?, ?, ?, ?, ?)`,
		date, address, score, moveLog, boardHash,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

type ScoreRow struct {
	Address string
	Score   int64
}

func TopScores(db *sql.DB, date string, limit int) ([]ScoreRow, error) {
	rows, err := db.Query(
		`SELECT address, score FROM blockparty_scores WHERE date=? ORDER BY score DESC, created_at ASC LIMIT ?`,
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
}

func GetStreak(db *sql.DB, address string) (Streak, error) {
	var s Streak
	var last sql.NullString
	err := db.QueryRow(
		`SELECT current, longest, freezes_remaining, last_played_date FROM blockparty_streaks WHERE address=?`, address,
	).Scan(&s.Current, &s.Longest, &s.FreezesRemaining, &last)
	if err == sql.ErrNoRows {
		return Streak{FreezesRemaining: 1}, nil
	}
	if err != nil {
		return Streak{}, err
	}
	s.LastPlayed = last.String
	return s, nil
}

// BumpStreak applies streak rules for a play on `date`:
//   - same date already played: no change
//   - consecutive day (date = last+1): current++
//   - exactly one missed day, a freeze available: freeze absorbs it, current++
//   - otherwise: reset to 1
//
// One freeze is refilled at the start of each new ISO week.
func BumpStreak(db *sql.DB, address, date string) (Streak, error) {
	s, err := GetStreak(db, address)
	if err != nil {
		return Streak{}, err
	}
	today, err := time.Parse("2006-01-02", date)
	if err != nil {
		return Streak{}, err
	}
	// weekly freeze refill
	wy, ww := today.ISOWeek()
	weekKey := isoWeekKey(wy, ww)
	freezes := s.FreezesRemaining
	prevWeekKey := ""
	_ = db.QueryRow(`SELECT week_anchor FROM blockparty_streaks WHERE address=?`, address).Scan(&prevWeekKey)
	if prevWeekKey != weekKey {
		freezes = 1
	}

	newCurrent := 1
	if s.LastPlayed != "" {
		last, _ := time.Parse("2006-01-02", s.LastPlayed)
		gap := int(today.Sub(last).Hours() / 24)
		switch {
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
	_, err = db.Exec(
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
	return Streak{Current: newCurrent, Longest: longest, FreezesRemaining: freezes, LastPlayed: date}, nil
}

// isoWeekKey formats an ISO year+week as e.g. "2026-W28".
func isoWeekKey(year, week int) string {
	return fmt.Sprintf("%04d-W%02d", year, week)
}

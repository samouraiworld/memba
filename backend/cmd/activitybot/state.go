package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"time"
)

// State is the rolling counter persisted between runs so MaxTransfersPerDay
// spans invocations (a scheduler may call the bot many times a day). Small,
// human-readable JSON.
type State struct {
	// DayUTC is the calendar day (UTC, "2006-01-02") the counter belongs to.
	DayUTC string `json:"dayUTC"`
	// TransfersToday is the number of value-moving actions broadcast today.
	TransfersToday int `json:"transfersToday"`
}

func dayKey(t time.Time) string { return t.UTC().Format("2006-01-02") }

// loadState reads the state file and rolls the counter to `now`'s day if the
// stored day is stale (or the file is absent). A missing file is not an error —
// it's the first run.
func loadState(path string, now time.Time) (*State, error) {
	raw, err := os.ReadFile(path) //nolint:gosec // operator-supplied state path (CLI arg)
	if errors.Is(err, fs.ErrNotExist) {
		return &State{DayUTC: dayKey(now)}, nil
	}
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	if s.DayUTC != dayKey(now) {
		// New day — reset the rolling counter.
		s.DayUTC = dayKey(now)
		s.TransfersToday = 0
	}
	return &s, nil
}

func saveState(path string, s *State) error {
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

// transfersRemaining is how many more value-moving actions the day budget allows.
func (s *State) transfersRemaining() int {
	rem := MaxTransfersPerDay - s.TransfersToday
	if rem < 0 {
		return 0
	}
	return rem
}

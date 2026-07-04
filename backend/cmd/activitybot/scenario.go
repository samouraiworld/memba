package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// ActionType is a kind of on-chain activity the bot can produce. Kept small and
// explicit — every type maps to a known, bounded gnokey command.
type ActionType string

const (
	// ActionFeedPost calls memba_feed_v1.CreatePost(body, "0"). No value moved.
	ActionFeedPost ActionType = "feed_post"
	// ActionTransfer sends a small ugnot amount to a recipient (value-moving —
	// counts against MaxTransfersPerDay + MaxTransferUgnot).
	ActionTransfer ActionType = "transfer"
)

// Action is one planned unit of activity.
type Action struct {
	Type ActionType `json:"type"`

	// ActionFeedPost
	Body string `json:"body,omitempty"`

	// ActionTransfer
	ToAddress string `json:"to,omitempty"`
	Ugnot     int64  `json:"ugnot,omitempty"`
}

// Scenario is the data-driven activity plan. The bot walks Actions in order up
// to the per-run limit; realm paths are here (not hardcoded) so the same binary
// serves whatever is deployed on the target network.
type Scenario struct {
	FeedRealm string   `json:"feedRealm"` // pkgpath for feed_post actions
	Actions   []Action `json:"actions"`
}

func loadScenario(path string) (*Scenario, error) {
	raw, err := os.ReadFile(path) //nolint:gosec // operator-supplied config path (CLI arg)
	if err != nil {
		return nil, err
	}
	var s Scenario
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}
	return &s, nil
}

// validate rejects a scenario the bot could not safely execute — an unknown
// action type, a transfer over the single-tx cap or without a recipient, a
// feed post without a configured realm or with an empty/over-long body. A
// scenario that would exceed the per-tx safety rails fails loudly here rather
// than being silently clamped.
func (s *Scenario) validate() error {
	if len(s.Actions) == 0 {
		return fmt.Errorf("scenario has no actions")
	}
	for i, a := range s.Actions {
		switch a.Type {
		case ActionFeedPost:
			if s.FeedRealm == "" {
				return fmt.Errorf("action %d: feed_post needs a feedRealm", i)
			}
			if strings.TrimSpace(a.Body) == "" {
				return fmt.Errorf("action %d: feed_post body is empty", i)
			}
			if len(a.Body) > 1000 { // realm MaxBodyLen
				return fmt.Errorf("action %d: feed_post body exceeds 1000 chars", i)
			}
			// Defense-in-depth: a body starting with "-" could be misparsed as a
			// gnokey flag rather than the -args value. Reject it.
			if strings.HasPrefix(a.Body, "-") {
				return fmt.Errorf("action %d: feed_post body must not start with '-'", i)
			}
		case ActionTransfer:
			if a.ToAddress == "" {
				return fmt.Errorf("action %d: transfer needs a `to` address", i)
			}
			if strings.HasPrefix(a.ToAddress, "-") {
				return fmt.Errorf("action %d: transfer `to` must not start with '-'", i)
			}
			if a.Ugnot <= 0 {
				return fmt.Errorf("action %d: transfer ugnot must be > 0", i)
			}
			if a.Ugnot > MaxTransferUgnot {
				return fmt.Errorf("action %d: transfer %dugnot exceeds MaxTransferUgnot (%d)", i, a.Ugnot, MaxTransferUgnot)
			}
		default:
			return fmt.Errorf("action %d: unknown type %q", i, a.Type)
		}
	}
	return nil
}

// isValueMoving reports whether an action counts against MaxTransfersPerDay.
func (a Action) isValueMoving() bool {
	return a.Type == ActionTransfer
}

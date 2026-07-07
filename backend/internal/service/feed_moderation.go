package service

// Serving-blocklist operator lever (feed W8.2 growth-safety gate). The feed is
// open-write and its post bodies are permanent on-chain (PostCreated event +
// feed_raw_events), and DeletePost only tombstones the projection — so illegal
// / must-not-serve content needs an out-of-band, ops-only suppression that every
// read path honors (see feed_rpc.go's `feed_blocklist` exclusions) and that
// on-chain events can't reverse. This endpoint is that lever.
//
// Bearer-gated + FAIL-CLOSED: disabled (404) unless FEED_MODERATION_BEARER is
// set, so it never exists as an open surface by accident.

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// HandleFeedModeration adds/removes a post from the serving-blocklist.
//   POST /api/feed/moderation  Authorization: Bearer <FEED_MODERATION_BEARER>
//   body: {"post_id": <id>, "action": "block"|"unblock", "reason": "...", "by": "..."}
func HandleFeedModeration(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bearer := strings.TrimSpace(os.Getenv("FEED_MODERATION_BEARER"))
		if bearer == "" {
			http.Error(w, "not found", http.StatusNotFound) // feature disabled
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !feedModBearerOK(r, bearer) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var body struct {
			PostID uint64 `json:"post_id"`
			Action string `json:"action"`
			Reason string `json:"reason"`
			By     string `json:"by"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil || body.PostID == 0 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		var err error
		switch body.Action {
		case "block":
			_, err = db.ExecContext(r.Context(), `
				INSERT INTO feed_blocklist (post_id, reason, added_by)
				VALUES (?, ?, ?)
				ON CONFLICT(post_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by`,
				body.PostID, body.Reason, body.By)
			slog.Warn("feed moderation: post blocklisted", "postId", body.PostID, "by", body.By, "reason", body.Reason)
		case "unblock":
			_, err = db.ExecContext(r.Context(), `DELETE FROM feed_blocklist WHERE post_id = ?`, body.PostID)
			slog.Warn("feed moderation: post un-blocklisted", "postId", body.PostID, "by", body.By)
		default:
			http.Error(w, `action must be "block" or "unblock"`, http.StatusBadRequest)
			return
		}
		if err != nil {
			slog.Error("feed moderation: db error", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "post_id": body.PostID, "action": body.Action})
	})
}

func feedModBearerOK(r *http.Request, want string) bool {
	got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

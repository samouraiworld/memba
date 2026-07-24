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

// HandleFeedModeration is the operator moderation endpoint.
//
//	POST /api/feed/moderation  Authorization: Bearer <FEED_MODERATION_BEARER>
//	body: {"post_id": <id>, "action": "...", "reason": "...", "by": "..."}
//
// Actions:
//   - "block" / "unblock":  add/remove a post from the serving-blocklist (hard,
//     out-of-band takedown that every read path honors; block also clears any
//     serving override so it can never be resurrected by a later unblock).
//   - "override_serve" / "clear_override" (feed v2 C.2): force a wrongly
//     flag-brigaded post back to full visibility, or revert. Refused (409) on a
//     deleted or blocklisted post — a serve-override can never re-serve
//     must-not-serve content.
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
			// Blocklist AND clear any serving override ATOMICALLY: block is
			// authoritative, and a partial apply (blocklist committed but the
			// override left behind) would let a later unblock resurrect the post as
			// overridden-visible (C.2 / G9).
			if tx, txErr := db.BeginTx(r.Context(), nil); txErr != nil {
				err = txErr
			} else {
				if _, err = tx.ExecContext(r.Context(), `
					INSERT INTO feed_blocklist (post_id, reason, added_by)
					VALUES (?, ?, ?)
					ON CONFLICT(post_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by`,
					body.PostID, body.Reason, body.By); err == nil {
					_, err = tx.ExecContext(r.Context(), `DELETE FROM feed_serving_overrides WHERE post_id = ?`, body.PostID)
				}
				if err == nil {
					err = tx.Commit()
				} else {
					_ = tx.Rollback()
				}
			}
			slog.Warn("feed moderation: post blocklisted", "postId", body.PostID, "by", body.By, "reason", body.Reason)
		case "unblock":
			_, err = db.ExecContext(r.Context(), `DELETE FROM feed_blocklist WHERE post_id = ?`, body.PostID)
			slog.Warn("feed moderation: post un-blocklisted", "postId", body.PostID, "by", body.By)
		case "override_serve":
			// Force a wrongly flag-brigaded post back to full visibility (feed v2
			// C.2). A serve-override is valid ONLY for a post that EXISTS and is
			// neither a deleted tombstone nor blocklisted — you can't vouch for
			// content you can't see, and read-path precedence keeps deleted/
			// blocklisted above an override anyway. Rejecting at the write boundary
			// keeps "only reviewable content is restored" an invariant and avoids a
			// dangling override that would pre-emptively auto-restore a future post.
			// (block stays pre-emptive: suppression is the safe direction.)
			var canServe bool
			if err = db.QueryRowContext(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM feed_posts WHERE post_id = ? AND deleted = 0)
				   AND NOT EXISTS(SELECT 1 FROM feed_blocklist WHERE post_id = ?)`,
				body.PostID, body.PostID).Scan(&canServe); err == nil && !canServe {
				http.Error(w, "post not found, deleted, or blocklisted; cannot serve-override", http.StatusConflict)
				return
			}
			if err == nil {
				_, err = db.ExecContext(r.Context(), `
					INSERT INTO feed_serving_overrides (post_id, reason, added_by)
					VALUES (?, ?, ?)
					ON CONFLICT(post_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by`,
					body.PostID, body.Reason, body.By)
				slog.Warn("feed moderation: post serve-override set", "postId", body.PostID, "by", body.By, "reason", body.Reason)
			}
		case "clear_override":
			_, err = db.ExecContext(r.Context(), `DELETE FROM feed_serving_overrides WHERE post_id = ?`, body.PostID)
			slog.Warn("feed moderation: post serve-override cleared", "postId", body.PostID, "by", body.By)
		default:
			http.Error(w, `action must be "block", "unblock", "override_serve", or "clear_override"`, http.StatusBadRequest)
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
	return feedModBearerOKHeader(r.Header, want)
}

// feedModBearerOKHeader is the header-only variant shared with ConnectRPC
// handlers (connect.Request exposes http.Header, not a full *http.Request).
func feedModBearerOKHeader(h http.Header, want string) bool {
	got := strings.TrimSpace(strings.TrimPrefix(h.Get("Authorization"), "Bearer "))
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

package service

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// safePathRe validates render path and agent ID parameters.
// Only allows alphanumeric, slashes, dashes, underscores, dots, colons, and equals.
var safePathRe = regexp.MustCompile(`^[a-zA-Z0-9/_\-.:=?&]*$`)

// feedPostPathRe matches the feed realm's per-post render path ("post/<id>").
// MODERATION_POLICY.md documents that this proxy relays the chain directly and
// so cannot be filtered by feed_blocklist like our own indexed reads — a
// blocklisted post is otherwise still readable here even after suppression
// (the realm's own Hidden/Deleted state is untouched by an operator
// blocklist, which is deliberately off-chain, see 021_feed_blocklist.sql).
// This closes that gap for the one render path it's cheap to close: a
// specific post is addressable, so it can be blocklist-checked before the
// chain is ever queried.
var feedPostPathRe = regexp.MustCompile(`^post/([0-9]+)$`)

// feedWatchedRealms returns the realm paths FEED_WATCHED_REALMS indexes
// (comma-separated, same convention as CORS_ORIGINS). Only these realms'
// post/<id> path is blocklist-checked — that render-path convention belongs
// to the feed realm; matching it against an unrelated realm would be a
// coincidence, not a moderation decision.
func feedWatchedRealms() []string {
	raw := os.Getenv("FEED_WATCHED_REALMS")
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	realms := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			realms = append(realms, p)
		}
	}
	return realms
}

func isWatchedFeedRealm(realm string) bool {
	for _, w := range feedWatchedRealms() {
		if w == realm {
			return true
		}
	}
	return false
}

// feedBlocklisted reports whether postID has an operator takedown recorded in
// feed_blocklist (see 021_feed_blocklist.sql) — a suppression that never
// comes from chain events and that no on-chain action can reverse.
func feedBlocklisted(db *sql.DB, postID uint64) (bool, error) {
	var exists int
	err := db.QueryRow(`SELECT 1 FROM feed_blocklist WHERE post_id = ?`, postID).Scan(&exists)
	switch {
	case err == sql.ErrNoRows:
		return false, nil
	case err != nil:
		return false, err
	default:
		return true, nil
	}
}

// feedPostUnavailableBody mirrors the feed realm's own renderPost suppression
// text (memba_feed_v2.gno) so a blocklisted post reads identically to one the
// realm itself already hides — the caller cannot distinguish an operator
// takedown from an on-chain hide/delete, which is the point.
const feedPostUnavailableBody = "# Post unavailable\n\n*This post has been hidden or removed.*\n"

// gnoRPCURL returns the RPC endpoint for the generic render/balance proxies.
// Overridable via GNO_RPC_URL (set to the pinned samourai topaz node in
// fly.toml). The built-in default is the same topaz node — NOT retired test13 — so
// an environment that forgets to set GNO_RPC_URL reads the right chain. The public
// node is reached only as a failover backup (see rpcURLsInOrder), which rate-
// limits the Fly egress IP (#466), so it is never the primary.
func gnoRPCURL() string {
	if url := os.Getenv("GNO_RPC_URL"); url != "" {
		return url
	}
	return "https://rpc.topaz.samourai.live:443"
}

// marketplaceRPCURL returns the RPC for the on-chain r/samcrew app realms read
// by the marketplace proxies and the analyst credit check (agent_registry,
// escrow_v2, …). It reads its OWN var (MARKETPLACE_RPC_URL, then NFT_RPC_URL)
// and defaults to the public topaz node, keeping marketplace reads decoupled
// from the generic GNO_RPC_URL even if that is ever repurposed. Failover backups
// are appended by rpcURLsInOrder.
func marketplaceRPCURL() string {
	for _, env := range []string{"MARKETPLACE_RPC_URL", "NFT_RPC_URL"} {
		if url := os.Getenv(env); url != "" {
			return url
		}
	}
	return "https://rpc.topaz.testnets.gno.land:443"
}

// abciResponse represents the relevant subset of a Gno ABCI query response.
//
// ResponseBase.Error is json.RawMessage, not string: gno.land encodes a present
// ABCI error as a JSON *object* for some failures (e.g. an unfunded/invalid
// account yields {"@type":"/std.InvalidAddressError"}). Typing it as string
// makes json.Unmarshal fail outright ("cannot unmarshal object into Go struct
// field ...ResponseBase.Error of type string"), turning a benign "no record"
// answer into an opaque parse error. RawMessage tolerates string OR object.
type abciResponse struct {
	Result struct {
		Response struct {
			ResponseBase struct {
				Data  string          `json:"Data"`
				Error json.RawMessage `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// abciErrorPresent reports whether an ABCI ResponseBase.Error represents a real
// error. gno.land sends "no error" as JSON null; a present error may be a string
// ("not found") OR an object ({"@type":"/std.InvalidAddressError"}). Anything
// that is not empty/null is treated as present.
func abciErrorPresent(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null" && s != `""`
}

// abciQueryRequest is the JSON-RPC request for ABCI queries.
// Using struct serialization instead of fmt.Sprintf prevents JSON injection
// via user-controlled data containing quotes or special characters.
type abciQueryRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Method  string          `json:"method"`
	Params  abciQueryParams `json:"params"`
}

type abciQueryParams struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

// abciQuery sends an ABCI query with automatic failover: it tries the primary
// RPC (rpcURL) then each backup node from rpcURLsInOrder until one answers
// without a transport error. A valid "no record" answer (empty result, nil
// error) is a success and does NOT advance to the next node — only
// connection/timeout/non-200/parse errors fail over. Returns the last transport
// error if every node fails.
func abciQuery(rpcURL, path, data string) (string, error) {
	var lastErr error
	for i, u := range rpcURLsInOrder(rpcURL) {
		out, err := abciQueryOnce(u, path, data)
		if err == nil {
			if i > 0 {
				slog.Warn("RPC primary unreachable; answered via fallback node", "fallback", u, "primary_err", lastErr)
			}
			return out, nil
		}
		lastErr = err
	}
	return "", lastErr
}

// abciQueryOnce performs a single ABCI query against one RPC node.
//
// The `data` param is base64-encoded on the wire: gno.land's abci_query decodes
// it as base64 (raw bytes fail with "Invalid params"/"illegal base64 data").
// Render-path queries must therefore use the "<pkgpath>:<renderpath>" colon
// syntax (a newline yields "expected <pkgpath>:<path> syntax").
func abciQueryOnce(rpcURL, path, data string) (string, error) {
	reqBody := abciQueryRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "abci_query",
		Params:  abciQueryParams{Path: path, Data: base64.StdEncoding.EncodeToString([]byte(data))},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: rpcAttemptTimeout}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	// A dead/sentry-throttled node returns a non-200 (often 502/503/429) with a
	// non-JSON body. Detect it explicitly so failover fires deterministically
	// instead of relying on a downstream JSON parse error. Drain the body first
	// so the keep-alive connection can be reused (close-without-drain leaks it).
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", fmt.Errorf("rpc http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	var result abciResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("rpc error: %s", result.Error.Message)
	}

	// A present ABCI ResponseBase.Error (e.g. /std.InvalidAddressError for an
	// unfunded/invalid account, or a "not found" render) means the chain has no
	// record to return — surface it as a clean empty result, not a hard error.
	// Genuine transport/parse/decode failures above still return an error.
	if abciErrorPresent(result.Result.Response.ResponseBase.Error) {
		return "", nil
	}

	if result.Result.Response.ResponseBase.Data == "" {
		return "", nil
	}

	decoded, err := base64.StdEncoding.DecodeString(result.Result.Response.ResponseBase.Data)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	return string(decoded), nil
}

// HandleRenderProxy handles GET /api/render?realm=...&path=...
// Proxies vm/qrender ABCI queries to the Gno RPC.
//
// Query params:
//   - realm: The realm path (required, e.g., "gno.land/r/gov/dao")
//   - path: The render path argument (optional, e.g., "42" for proposal #42)
//
// Returns: plain text Render() output, or JSON error. A blocklisted feed post
// (feed_blocklist, see MODERATION_POLICY.md) is suppressed before the chain
// is queried — see feedBlocklisted.
func HandleRenderProxy(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		realm := r.URL.Query().Get("realm")
		if realm == "" {
			http.Error(w, `{"error":"realm parameter is required"}`, http.StatusBadRequest)
			return
		}

		// Validate realm path — must start with gno.land/r/ and contain only safe chars
		if !strings.HasPrefix(realm, "gno.land/r/") {
			http.Error(w, `{"error":"realm must start with gno.land/r/"}`, http.StatusBadRequest)
			return
		}

		renderPath := r.URL.Query().Get("path")
		if renderPath != "" && !safePathRe.MatchString(renderPath) {
			http.Error(w, `{"error":"invalid path characters"}`, http.StatusBadRequest)
			return
		}

		if isWatchedFeedRealm(realm) {
			if m := feedPostPathRe.FindStringSubmatch(renderPath); m != nil {
				// ParseUint cannot fail here: feedPostPathRe already pinned the
				// capture to digits. An overflowing id (>2^64) is not a post the
				// realm can render either, so treat it as unfiltered.
				if postID, perr := strconv.ParseUint(m[1], 10, 64); perr == nil {
					blocked, err := feedBlocklisted(db, postID)
					// FAIL CLOSED. This is a takedown lever for illegal content:
					// serving a post we cannot prove is unblocked would reopen
					// the exact bypass this check exists to close. The cost is
					// bounded — it suppresses only per-post feed renders, and
					// the blocklist lives in the same DB every feed read path
					// already depends on, so a DB failure has the feed down
					// regardless.
					if err != nil {
						slog.Error("render proxy: blocklist check failed, suppressing post", "realm", realm, "post_id", postID, "error", err)
					}
					if err != nil || blocked {
						w.Header().Set("Content-Type", "text/plain; charset=utf-8")
						w.Header().Set("Cache-Control", "no-store")
						_, _ = fmt.Fprint(w, feedPostUnavailableBody)
						return
					}
				}
			}
		}

		// vm/qrender wire format: "<pkgpath>:<renderpath>" (colon separator).
		data := realm + ":" + renderPath

		result, err := abciQuery(gnoRPCURL(), "vm/qrender", data)
		if err != nil {
			slog.Warn("render proxy failed", "realm", realm, "path", renderPath, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=5")
		_, _ = fmt.Fprint(w, result)
	})
}

// HandleEvalProxy was removed in v6 (SEC-01) — it allowed arbitrary vm/qeval
// queries on any realm without authentication. Use HandleRenderProxy for
// legitimate read-only queries via vm/qrender.

// HandleBalanceProxy handles GET /api/balance?address=...
// Proxies bank/balances ABCI queries to the Gno RPC.
func HandleBalanceProxy() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		address := r.URL.Query().Get("address")
		if address == "" {
			http.Error(w, `{"error":"address parameter is required"}`, http.StatusBadRequest)
			return
		}

		// Validate address format (g1 + 38 lowercase alphanum)
		if !strings.HasPrefix(address, "g1") || len(address) != 40 {
			http.Error(w, `{"error":"invalid address format (expected g1 + 38 chars)"}`, http.StatusBadRequest)
			return
		}

		result, err := abciQuery(gnoRPCURL(), "bank/balances/"+address, "")
		if err != nil {
			slog.Warn("balance proxy failed", "address", address, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=10")
		_, _ = fmt.Fprint(w, result)
	})
}

// HandleMarketplaceAgentsProxy handles GET /api/marketplace/agents
// and GET /api/marketplace/agents?id=<agentId>
//
// Caches the agent registry Render() output server-side (60s TTL)
// so multiple frontend clients don't each hit the RPC node.
func HandleMarketplaceAgentsProxy(registryPath string) http.Handler {
	var (
		mu       sync.RWMutex
		cached   string
		cachedAt time.Time
		cacheTTL = 60 * time.Second
	)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		agentID := r.URL.Query().Get("id")

		// Single agent detail — not cached, pass through
		if agentID != "" {
			if !safePathRe.MatchString(agentID) {
				http.Error(w, `{"error":"invalid agent ID characters"}`, http.StatusBadRequest)
				return
			}
			data := registryPath + ":agent/" + agentID
			result, err := abciQuery(marketplaceRPCURL(), "vm/qrender", data)
			if err != nil {
				slog.Warn("marketplace agent detail failed", "id", agentID, "error", err)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_, _ = fmt.Fprintf(w, `{"error":%q}`, err.Error())
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=10")
			_, _ = fmt.Fprint(w, result)
			return
		}

		// Agent listing — cached
		mu.RLock()
		if cached != "" && time.Since(cachedAt) < cacheTTL {
			data := cached
			mu.RUnlock()
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=60")
			w.Header().Set("X-Cache", "HIT")
			_, _ = fmt.Fprint(w, data)
			return
		}
		mu.RUnlock()

		// Cache miss — fetch from chain
		data := registryPath + ":"
		result, err := abciQuery(marketplaceRPCURL(), "vm/qrender", data)
		if err != nil {
			slog.Warn("marketplace agents listing failed", "error", err)
			// Serve stale cache if available
			mu.RLock()
			if cached != "" {
				data := cached
				mu.RUnlock()
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.Header().Set("Cache-Control", "public, max-age=5")
				w.Header().Set("X-Cache", "STALE")
				_, _ = fmt.Fprint(w, data)
				return
			}
			mu.RUnlock()

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		// Update cache
		mu.Lock()
		cached = result
		cachedAt = time.Now()
		mu.Unlock()

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Header().Set("X-Cache", "MISS")
		_, _ = fmt.Fprint(w, result)
	})
}

package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// safePathRe validates render path and agent ID parameters.
// Only allows alphanumeric, slashes, dashes, underscores, dots, colons, and equals.
var safePathRe = regexp.MustCompile(`^[a-zA-Z0-9/_\-.:=?&]*$`)

// gnoRPCURL returns the RPC endpoint for the generic render/balance proxies.
// Overridable via GNO_RPC_URL (set to the pinned samourai test13 node in
// fly.toml). The built-in default is the same test13 node — NOT test12 — so an
// environment that forgets to set GNO_RPC_URL reads the right chain. The public
// node is reached only as a failover backup (see rpcURLsInOrder), which rate-
// limits the Fly egress IP (#466), so it is never the primary.
func gnoRPCURL() string {
	if url := os.Getenv("GNO_RPC_URL"); url != "" {
		return url
	}
	return "https://rpc.testnet13.samourai.live:443"
}

// marketplaceRPCURL returns the RPC for the on-chain r/samcrew app realms read
// by the marketplace proxies and the analyst credit check (agent_registry,
// escrow_v2, …). It reads its OWN var (MARKETPLACE_RPC_URL, then NFT_RPC_URL)
// and defaults to the public test13 node, keeping marketplace reads decoupled
// from the generic GNO_RPC_URL even if that is ever repurposed. Failover backups
// are appended by rpcURLsInOrder.
func marketplaceRPCURL() string {
	for _, env := range []string{"MARKETPLACE_RPC_URL", "NFT_RPC_URL"} {
		if url := os.Getenv(env); url != "" {
			return url
		}
	}
	return "https://rpc.test13.testnets.gno.land:443"
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

// abciQuery sends a JSON-RPC ABCI query to the Gno RPC and returns the decoded result.
//
// The `data` param is base64-encoded on the wire: gno.land's abci_query decodes
// it as base64 (raw bytes fail with "Invalid params"/"illegal base64 data").
// Render-path queries must therefore use the "<pkgpath>:<renderpath>" colon
// syntax (a newline yields "expected <pkgpath>:<path> syntax").
func abciQuery(rpcURL, path, data string) (string, error) {
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

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
// Returns: plain text Render() output, or JSON error.
func HandleRenderProxy() http.Handler {
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

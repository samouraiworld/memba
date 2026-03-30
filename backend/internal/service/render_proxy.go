package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// Default Gno RPC endpoint — overridable via GNO_RPC_URL env var.
func gnoRPCURL() string {
	if url := os.Getenv("GNO_RPC_URL"); url != "" {
		return url
	}
	return "https://rpc.testnet12.samourai.live:443"
}

// abciResponse represents the relevant subset of a Gno ABCI query response.
type abciResponse struct {
	Result struct {
		Response struct {
			ResponseBase struct {
				Data  string `json:"Data"`
				Error string `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// abciQuery sends a JSON-RPC ABCI query to the Gno RPC and returns the decoded result.
func abciQuery(rpcURL, path, data string) (string, error) {
	payload := fmt.Sprintf(
		`{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"%s","data":"%s"}}`,
		path, data,
	)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer resp.Body.Close()

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

	if result.Result.Response.ResponseBase.Error != "" {
		return "", fmt.Errorf("abci error: %s", result.Result.Response.ResponseBase.Error)
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
		data := realm + "\n" + renderPath

		result, err := abciQuery(gnoRPCURL(), "vm/qrender", data)
		if err != nil {
			slog.Warn("render proxy failed", "realm", realm, "path", renderPath, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=5")
		fmt.Fprint(w, result)
	})
}

// HandleEvalProxy handles GET /api/eval?realm=...&expr=...
// Proxies vm/qeval ABCI queries to the Gno RPC.
//
// Query params:
//   - realm: The realm path (required)
//   - expr: The expression to evaluate (required, e.g., "IsArchived()")
func HandleEvalProxy() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		realm := r.URL.Query().Get("realm")
		expr := r.URL.Query().Get("expr")
		if realm == "" || expr == "" {
			http.Error(w, `{"error":"realm and expr parameters are required"}`, http.StatusBadRequest)
			return
		}

		if !strings.HasPrefix(realm, "gno.land/") {
			http.Error(w, `{"error":"realm must start with gno.land/"}`, http.StatusBadRequest)
			return
		}

		data := realm + "\n" + expr

		result, err := abciQuery(gnoRPCURL(), "vm/qeval", data)
		if err != nil {
			slog.Warn("eval proxy failed", "realm", realm, "expr", expr, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=5")
		fmt.Fprint(w, result)
	})
}

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
			fmt.Fprintf(w, `{"error":%q}`, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=10")
		fmt.Fprint(w, result)
	})
}

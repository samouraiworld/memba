package service

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
)

type allowlistEntry struct {
	MaxQty int64  `json:"maxQty"`
	Proof  string `json:"proof"`
}

type allowlistFile struct {
	Root    string                    `json:"root"`
	Entries map[string]allowlistEntry `json:"entries"`
}

// HandleAllowlistProof serves per-wallet Merkle proofs for the launchpad's
// MintAllowlist from the file produced by allowlist_tool.py. path == "" (env
// unset) disables the endpoint (always 404). The file is read once and cached:
// the allowlist is frozen by the on-chain root, so hot-reload would only
// invite drift between what we serve and what the realm verifies.
func HandleAllowlistProof(path string) http.Handler {
	var once sync.Once
	var data *allowlistFile
	load := func() {
		if path == "" {
			return
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			// Endpoint stays disabled. Logged here (not only at the main.go
			// boot Stat) so a file that turns unreadable after boot still
			// leaves a signal.
			slog.Warn("allowlist proofs: failed to read file", "path", path, "error", err)
			return
		}
		var f allowlistFile
		if err := json.Unmarshal(raw, &f); err != nil {
			slog.Warn("allowlist proofs: failed to parse JSON", "path", path, "error", err)
			return
		}
		data = &f
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		once.Do(load)
		addr := r.URL.Query().Get("address")
		if data == nil || addr == "" {
			http.NotFound(w, r)
			return
		}
		e, ok := data.Entries[addr]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"root": data.Root, "maxQty": e.MaxQty, "proof": e.Proof,
		})
	})
}

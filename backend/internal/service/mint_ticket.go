package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// TicketConfig configures the mint-ticket endpoint. Zero-value = disabled.
type TicketConfig struct {
	CollectionID   string
	URIBase        string // normalized to end with "/"
	Prefix         string // default "Memba"
	ReserveSeconds int    // default 90
}

// HandleMintTicket suggests the next free tokenURI for the curated launchpad
// mint. The tid source of truth is our own indexer projection: memba_collections
// token ids are strictly sequential and Burn never reopens a slot, so the
// minted count IS the next 0-based tid. In-process reservations bridge the gap
// between "ticket handed out" and "mint indexed"; they expire so abandoned
// carts free their slot. This narrows — but cannot close — the URI race
// between concurrent wallets (accepted: the Misprint policy, brief §7).
func HandleMintTicket(db *sql.DB, cfg TicketConfig) http.Handler {
	if cfg.Prefix == "" {
		cfg.Prefix = "Memba"
	}
	if cfg.ReserveSeconds <= 0 {
		cfg.ReserveSeconds = 90
	}
	if cfg.URIBase != "" && cfg.URIBase[len(cfg.URIBase)-1] != '/' {
		cfg.URIBase += "/"
	}
	var mu sync.Mutex
	reserved := map[int64]time.Time{} // tid -> reservation expiry
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if db == nil || cfg.CollectionID == "" || cfg.URIBase == "" {
			http.NotFound(w, r)
			return
		}
		// Tickets are scoped to THE curated collection: the client must name
		// the collection it is minting for, and anything else 404s. Studio is
		// multi-tenant — without this, the Membas ticket would leak into every
		// other collection's mint form.
		if r.URL.Query().Get("collection") != cfg.CollectionID {
			http.NotFound(w, r)
			return
		}
		var minted int64
		if err := db.QueryRow(
			`SELECT COUNT(*) FROM nft_tokens WHERE collection_id = ?`, cfg.CollectionID,
		).Scan(&minted); err != nil {
			slog.Error("mint ticket: count query failed", "collection_id", cfg.CollectionID, "error", err)
			http.Error(w, "ticket source unavailable", http.StatusServiceUnavailable)
			return
		}
		mu.Lock()
		now := time.Now()
		for tid, exp := range reserved {
			if now.After(exp) {
				delete(reserved, tid)
			}
		}
		tid := minted
		for {
			if _, taken := reserved[tid]; !taken {
				break
			}
			tid++
		}
		reserved[tid] = now.Add(time.Duration(cfg.ReserveSeconds) * time.Second)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tid":      tid,
			"edition":  tid + 1,
			"tokenURI": fmt.Sprintf("%s%s_%04d.json", cfg.URIBase, cfg.Prefix, tid+1),
		})
	})
}

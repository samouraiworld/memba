// Command badge-mint is the operator tool for the manual multisig badge-mint
// flow (Phase 2 / D2c). The Memba backend has no transaction signer, so this
// CLI drains the badge_mints queue into gnokey mint calls that the samcrew
// multisig signs and broadcasts; it then records the result.
//
// The queue is safe to drain directly: rows are only enqueued from verified
// completions (CompleteQuest gates on-chain server-side; self-report quests go
// through admin-approved claims), so no re-verification is needed here.
//
// Usage:
//
//	badge-mint -db memba.db                      # list pending + emit mint calls
//	badge-mint -db memba.db -mark-minted -id 42 -tx 0xABC...
//	badge-mint -db memba.db -mark-failed -id 42 -reason "rejected by realm"
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

func main() {
	var (
		dbPath     = flag.String("db", "memba.db", "path to the SQLite database")
		realm      = flag.String("realm", "gno.land/r/samcrew/gnobuilders_badges_v2", "badge realm pkgpath")
		key        = flag.String("key", "samcrew-multisig", "gnokey key name for the multisig signer")
		chainID    = flag.String("chain-id", "test-13", "gno chain id")
		remote     = flag.String("remote", "https://rpc.test13.testnets.gno.land:443", "gno RPC endpoint")
		markMinted = flag.Bool("mark-minted", false, "mark a queued mint as minted (needs -id, -tx)")
		markFailed = flag.Bool("mark-failed", false, "mark a queued mint as failed (needs -id)")
		id         = flag.Int64("id", 0, "badge_mints row id")
		txHash     = flag.String("tx", "", "broadcast tx hash (for -mark-minted)")
		reason     = flag.String("reason", "", "failure reason (for -mark-failed)")
	)
	flag.Parse()

	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		fatal("open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	switch {
	case *markMinted:
		if *id == 0 || *txHash == "" {
			fatal("-mark-minted requires -id and -tx")
		}
		mustExec(db, `UPDATE badge_mints SET mint_status='minted', tx_hash=?, minted_at=CURRENT_TIMESTAMP WHERE id=?`, *txHash, *id)
		fmt.Printf("marked mint %d minted (tx %s)\n", *id, *txHash)
	case *markFailed:
		if *id == 0 {
			fatal("-mark-failed requires -id")
		}
		mustExec(db, `UPDATE badge_mints SET mint_status='failed', retry_count=retry_count+1, last_error=? WHERE id=?`, *reason, *id)
		fmt.Printf("marked mint %d failed\n", *id)
	default:
		mints, err := pendingMints(db)
		if err != nil {
			fatal("%v", err)
		}
		emitMintCalls(os.Stdout, mints, *realm, *key, *chainID, *remote)
	}
}

// pendingMint is one queued badge mint.
type pendingMint struct {
	ID      int64
	Address string
	QuestID string
}

// pendingMints returns all badge_mints rows awaiting an on-chain mint.
func pendingMints(db *sql.DB) ([]pendingMint, error) {
	rows, err := db.Query(`SELECT id, address, quest_id FROM badge_mints WHERE mint_status='pending' ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query pending: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []pendingMint
	for rows.Next() {
		var m pendingMint
		if err := rows.Scan(&m.ID, &m.Address, &m.QuestID); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// emitMintCalls writes a gnokey mint command per pending row. Rank badges
// (quest_id "rank:N") use MintRankBadge; everything else MintQuestBadge. The
// tokenURI arg is left empty — set it (or UpdateTokenURI post-mint) once badge
// metadata is pinned to IPFS.
func emitMintCalls(w *os.File, mints []pendingMint, realm, key, chainID, remote string) {
	_, _ = fmt.Fprintf(w, "# %d pending badge mint(s). Sign+broadcast each with the multisig, then run -mark-minted -id <id> -tx <hash>.\n", len(mints))
	for _, m := range mints {
		_, _ = fmt.Fprintf(w, "\n# mint #%d  addr=%s  quest=%s\n", m.ID, m.Address, m.QuestID)
		fn, arg2 := "MintQuestBadge", m.QuestID
		if tier, ok := rankTier(m.QuestID); ok {
			fn, arg2 = "MintRankBadge", strconv.Itoa(tier)
		}
		_, _ = fmt.Fprintf(w,
			"gnokey maketx call -pkgpath %q -func %s -args %q -args %q -args %q -gas-fee 1000000ugnot -gas-wanted 10000000 -chainid %q -remote %q -broadcast %s\n",
			realm, fn, m.Address, arg2, "", chainID, remote, key)
	}
}

// rankTier parses a "rank:N" quest_id into its tier number.
func rankTier(questID string) (int, bool) {
	if !strings.HasPrefix(questID, "rank:") {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimPrefix(questID, "rank:"))
	if err != nil {
		return 0, false
	}
	return n, true
}

func mustExec(db *sql.DB, query string, args ...any) {
	if _, err := db.Exec(query, args...); err != nil {
		fatal("exec: %v", err)
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "badge-mint: "+format+"\n", args...)
	os.Exit(1)
}

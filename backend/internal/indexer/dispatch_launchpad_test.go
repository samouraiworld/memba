package indexer

import (
	"context"
	"testing"
)

const launchpadPkg = "gno.land/r/samcrew/memba_collections"

// paidMintAttrs mirrors the exact attributes memba_collections emits for
// MintPublic/MintAllowlist (mint.gno) — crucially there is NO "to" attr:
// the minter receives the token.
func paidMintAttrs(tokenID string) map[string]string {
	return map[string]string{
		"collectionID": "g1creator/membas",
		"tokenId":      tokenID,
		"minter":       "g1buyerfulladdress",
		"payer":        "g1buyerfulladdress",
		"price":        "20000000",
		"denom":        "ugnot",
		"primaryFee":   "0",
		"creatorAmt":   "20000000",
		"phase":        "1",
		"isSelfMint":   "false",
		"mintedAfter":  "1",
		"block":        "424242",
	}
}

func TestDispatch_MintPublic_ProjectsToken(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("MintPublic", launchpadPkg, 424242, 0, 0, paidMintAttrs("0")), ""))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_tokens WHERE collection_id='g1creator/membas' AND token_id='0'`); n != 1 {
		t.Fatalf("MintPublic projected %d token rows, want 1", n)
	}
	var owner string
	if err := db.QueryRow(`SELECT owner FROM nft_tokens WHERE collection_id='g1creator/membas' AND token_id='0'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != "g1buyerfulladdress" {
		t.Fatalf("owner = %q, want the minter (no \"to\" attr on paid mints)", owner)
	}
}

func TestDispatch_MintAllowlist_MatchesAdminMintProjection(t *testing.T) {
	ctx := context.Background()

	// Reference: admin Mint (carries "to").
	dbA := openTestDB(t)
	must(t, dispatchEvent(ctx, dbA, ev("Mint", launchpadPkg, 100, 0, 0, map[string]string{
		"collectionID": "g1creator/membas", "tokenId": "7",
		"minter": "g1adminfulladdress", "to": "g1buyerfulladdress", "block": "100",
	}), ""))

	// Same token via MintAllowlist (no "to" — minter receives).
	dbB := openTestDB(t)
	must(t, dispatchEvent(ctx, dbB, ev("MintAllowlist", launchpadPkg, 100, 0, 0, paidMintAttrs("7")), ""))

	qa := countRows(t, dbA, `SELECT COUNT(*) FROM nft_tokens WHERE collection_id='g1creator/membas' AND token_id='7'`)
	qb := countRows(t, dbB, `SELECT COUNT(*) FROM nft_tokens WHERE collection_id='g1creator/membas' AND token_id='7'`)
	if qa != 1 || qb != 1 {
		t.Fatalf("projection mismatch: admin=%d allowlist=%d, want 1 and 1", qa, qb)
	}
}

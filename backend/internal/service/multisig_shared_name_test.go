package service

import (
	"context"
	"database/sql"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// A member whose own name for a multisig is empty is shown the earliest name
// another member gave it, and who gave it; their own name always wins. Read
// time only: nothing is copied into their row.
func TestSharedNameFallsBackToTheEarliestNameGiven(t *testing.T) {
	h := setup(t)
	h.svc.chainID = "native-local"
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	pk, keys, j := nativeTestIdentity(t)
	addr := pk.Address().String()
	ctx := context.Background()
	token := map[string]*membav1.Token{}
	for _, k := range keys {
		a := k.PubKey().Address().String()
		token[a] = nativeTestToken(t, h, a)
	}
	join := func(member, name string) {
		t.Helper()
		if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(&membav1.CreateOrJoinMultisigRequest{AuthToken: token[member], ChainId: h.svc.chainID, MultisigPubkeyJson: j, ExpectedMultisigAddress: addr, Name: name, Bech32Prefix: "g"})); err != nil {
			t.Fatal(err)
		}
	}
	info := func(member string) *membav1.Multisig {
		t.Helper()
		got, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{AuthToken: token[member], ChainId: h.svc.chainID, MultisigAddress: addr}))
		if err != nil {
			t.Fatal(err)
		}
		list, err := h.svc.Multisigs(ctx, connect.NewRequest(&membav1.MultisigsRequest{AuthToken: token[member], ChainId: h.svc.chainID}))
		if err != nil || len(list.Msg.Multisigs) != 1 {
			t.Fatalf("list: %v, %v", list, err)
		}
		if l := list.Msg.Multisigs[0]; l.Name != got.Msg.Multisig.Name || l.SharedName != got.Msg.Multisig.SharedName || l.NamedBy != got.Msg.Multisig.NamedBy {
			t.Fatalf("list and info disagree: %+v vs %+v", l, got.Msg.Multisig)
		}
		return got.Msg.Multisig
	}
	want := func(member, own, shared, by string) {
		t.Helper()
		m := info(member)
		if m.Name != own || m.SharedName != shared || m.NamedBy != by {
			t.Fatalf("%s sees name %q, shared %q by %q; want %q, %q by %q", member[:8], m.Name, m.SharedName, m.NamedBy, own, shared, by)
		}
	}
	nameSetAt := func(member string) sql.NullString {
		t.Helper()
		var at sql.NullString
		if err := h.svc.db.QueryRow("SELECT name_set_at FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ?", h.svc.chainID, member, addr).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}

	// Registered without a name: nobody has a name to show.
	registrant := keys[0].PubKey().Address().String()
	join(registrant, "")
	if nameSetAt(registrant).Valid {
		t.Fatal("a join without a name recorded a naming time")
	}
	// Row order (registration, key order): first F, last L, and T the third.
	rows, err := h.svc.db.Query("SELECT user_address FROM user_multisigs WHERE chain_id = ? AND multisig_address = ? ORDER BY rowid", h.svc.chainID, addr)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		order = append(order, a)
	}
	_ = rows.Close()
	first, third, last := order[0], order[1], order[2]
	// Older names on the same address on another chain, and on another
	// multisig on this chain, belong to those accounts only.
	decoy := "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj"
	for _, row := range [][3]string{{"other-chain", addr, "Other chain"}, {h.svc.chainID, decoy, "Other multisig"}} {
		if _, err := h.svc.db.Exec("INSERT INTO multisigs (chain_id, address, pubkey_json, threshold, members_count, created_at) VALUES (?, ?, '{}', 1, 1, '2000-01-01T00:00:00Z')", row[0], row[1]); err != nil {
			t.Fatal(err)
		}
		if _, err := h.svc.db.Exec("INSERT INTO user_multisigs (chain_id, user_address, multisig_address, name, name_set_at, joined, created_at) VALUES (?, ?, ?, ?, '2000-01-01T00:00:00.000000000Z', TRUE, '2000-01-01T00:00:00Z')", row[0], decoy, row[1], row[2]); err != nil {
			t.Fatal(err)
		}
	}
	want(third, "", "", "")

	// The member whose row sorts last names it first (join path, existing row).
	join(last, "Treasury")
	if !nameSetAt(last).Valid {
		t.Fatal("joining with a name recorded no naming time")
	}
	want(third, "", "Treasury", last)
	want(last, "Treasury", "", "")

	// The first-sorting member names it later, then renames it (rename path):
	// the others' fallback stays with the first namer.
	join(first, "Mine")
	before := nameSetAt(first)
	join(first, "Mine again")
	if after := nameSetAt(first); after != before {
		t.Fatalf("a rename moved the first naming time: %v then %v", before, after)
	}
	want(third, "", "Treasury", last)
	want(first, "Mine again", "", "")
	// The first namer renames: they keep the slot, and the label follows their new name.
	join(last, "Treasury 2")
	want(third, "", "Treasury 2", last)

	// A row written by the insert path (a member whose row is missing) records it too.
	if _, err := h.svc.db.Exec("DELETE FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ?", h.svc.chainID, third, addr); err != nil {
		t.Fatal(err)
	}
	join(third, "Tee")
	if !nameSetAt(third).Valid {
		t.Fatal("the insert path recorded no naming time")
	}
	want(third, "Tee", "", "")

	// Names given before the column existed have no naming time and order by
	// their row's creation, ahead of any name given since.
	if _, err := h.svc.db.Exec("UPDATE user_multisigs SET name_set_at = NULL, created_at = '2026-01-01T00:00:00Z' WHERE chain_id = ? AND user_address = ? AND multisig_address = ?", h.svc.chainID, first, addr); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.db.Exec("UPDATE user_multisigs SET name = '', name_set_at = NULL WHERE chain_id = ? AND user_address = ? AND multisig_address = ?", h.svc.chainID, third, addr); err != nil {
		t.Fatal(err)
	}
	want(third, "", "Mine again", first)
	// Two such names: the older row wins, whatever the insertion order.
	if _, err := h.svc.db.Exec("UPDATE user_multisigs SET name_set_at = NULL, created_at = '2025-12-01T00:00:00Z' WHERE chain_id = ? AND user_address = ? AND multisig_address = ?", h.svc.chainID, last, addr); err != nil {
		t.Fatal(err)
	}
	want(third, "", "Treasury 2", last)

	// A stranger still learns nothing.
	stranger := nativeTestToken(t, h, "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	if _, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{AuthToken: stranger, ChainId: h.svc.chainID, MultisigAddress: addr})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("stranger: %v", err)
	}
}

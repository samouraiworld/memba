package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/gnomultisig"
)

// A member another member registered has a row with joined = FALSE: their key
// is in the multisig by construction. They read, propose and sign without
// joining; joining only lists the account (and its name) for them. A stranger
// stays out.
func TestUnjoinedMemberReadsProposesAndSigns(t *testing.T) {
	h := setup(t)
	h.svc.chainID = "native-local"
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	t.Setenv("MEMBA_ENFORCE_MULTISIG_SIG_VERIFY", "false")
	pk, keys, j := nativeTestIdentity(t)
	addr := pk.Address().String()
	ctx := context.Background()
	member := func(i int) *membav1.Token { return nativeTestToken(t, h, keys[i].PubKey().Address().String()) }
	// Only key 0 registers the multisig; keys 1 and 2 never join.
	if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(&membav1.CreateOrJoinMultisigRequest{AuthToken: member(0), ChainId: h.svc.chainID, MultisigPubkeyJson: j, ExpectedMultisigAddress: addr, Bech32Prefix: "g"})); err != nil {
		t.Fatal(err)
	}

	created, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{AuthToken: member(1), ChainId: h.svc.chainID, MultisigAddress: addr,
		MsgsJson: fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot"}]`, addr, keys[0].PubKey().Address()),
		FeeJson:  `{"gas_wanted":"1000000","gas_fee":"100000ugnot"}`, AccountNumber: 7, Sequence: 3}))
	if err != nil {
		t.Fatal("an unjoined member could not propose:", err)
	}
	id := created.Msg.TransactionId

	for _, i := range []int{1, 2} {
		list, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{AuthToken: member(i), ChainId: h.svc.chainID, MultisigAddress: addr}))
		if err != nil || len(list.Msg.Transactions) != 1 {
			t.Fatalf("key %d: list %v, %v", i, list, err)
		}
		// Without a multisig filter too: what waits for them across their memberships.
		all, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{AuthToken: member(i), ChainId: h.svc.chainID}))
		if err != nil || len(all.Msg.Transactions) != 1 {
			t.Fatalf("key %d: unfiltered list %v, %v", i, all, err)
		}
	}

	got, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{AuthToken: member(2), TransactionId: id}))
	if err != nil {
		t.Fatal("an unjoined member could not open the transaction:", err)
	}
	f := nativeFields(got.Msg.Transaction)
	unsigned, err := gnomultisig.Transaction(f, addr)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := unsigned.GetSignBytes(f.ChainID, f.AccountNumber, f.Sequence)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{1, 2} {
		sig, err := keys[i].Sign(bytes)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: member(i), TransactionId: id, Signature: base64.StdEncoding.EncodeToString(sig)})); err != nil {
			t.Fatalf("key %d (unjoined) could not sign: %v", i, err)
		}
	}

	// Signing does not list the account for them: joined stays theirs to set.
	info, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{AuthToken: member(2), ChainId: h.svc.chainID, MultisigAddress: addr}))
	if err != nil || info.Msg.Multisig.Joined {
		t.Fatalf("joined changed by signing: %v, %v", info, err)
	}

	// Recording an execution needs a chain receipt this test has none of; what
	// matters here is that membership is not what refuses it.
	complete := func(token *membav1.Token) error {
		_, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: token, TransactionId: id, FinalHash: "AAAA"}))
		return err
	}
	if err := complete(member(2)); connect.CodeOf(err) == connect.CodePermissionDenied {
		t.Fatalf("an unjoined member was refused as a non-member when recording the execution: %v", err)
	}

	stranger := nativeTestToken(t, h, "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	if err := complete(stranger); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a stranger's execution record was not refused as a non-member: %v", err)
	}
	if _, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{AuthToken: stranger, TransactionId: id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a stranger opened the transaction: %v", err)
	}
	if list, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{AuthToken: stranger, ChainId: h.svc.chainID})); err != nil || len(list.Msg.Transactions) != 0 {
		t.Fatalf("a stranger listed transactions: %v, %v", list, err)
	}
	if _, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{AuthToken: stranger, ChainId: h.svc.chainID, MultisigAddress: addr, MsgsJson: `[]`, FeeJson: `{"gas_wanted":"1000000","gas_fee":"100000ugnot"}`})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a stranger's proposal was not refused as a non-member: %v", err)
	}
	if _, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: stranger, TransactionId: id, Signature: "AAAA"})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a stranger's signature was not refused as a non-member: %v", err)
	}
}

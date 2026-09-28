package service

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestTransactionsOmitsSignaturePayloadButGetTransactionRetainsIt(t *testing.T) {
	h := setup(t)
	const chainID = "test11"
	const multisigAddress = "g1multisig1"
	const member = "g1alice"
	h.seedMultisig(t, chainID, multisigAddress, `{}`, 1, 1, []string{member})

	res, err := h.db.Exec(
		`INSERT INTO transactions (chain_id, multisig_address, msgs_json, fee_json, account_number, sequence, creator_address)
		 VALUES (?, ?, ?, ?, 1, 1, ?)`,
		chainID, multisigAddress, `[]`, `{}`, member,
	)
	if err != nil {
		t.Fatal("insert transaction:", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal("transaction ID:", err)
	}
	value := strings.Repeat("s", 32*1024)
	body := bytes.Repeat([]byte("b"), 128*1024)
	_, err = h.db.Exec(
		`INSERT INTO signatures (transaction_id, user_address, signature, body_bytes, verified) VALUES (?, ?, ?, ?, TRUE)`,
		id, member, value, body,
	)
	if err != nil {
		t.Fatal("insert signature:", err)
	}

	token := h.makeToken(t, member)
	ctx := context.Background()
	list, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken: token, ChainId: chainID, MultisigAddress: multisigAddress,
	}))
	if err != nil {
		t.Fatal("list transactions:", err)
	}
	if len(list.Msg.Transactions) != 1 || len(list.Msg.Transactions[0].Signatures) != 1 {
		t.Fatalf("list must retain one transaction and one signature: %+v", list.Msg.Transactions)
	}
	listed := list.Msg.Transactions[0].Signatures[0]
	if listed.UserAddress != member || !listed.Verified || listed.CreatedAt == "" {
		t.Fatalf("list lost signature display metadata: %+v", listed)
	}
	if listed.Value != "" || len(listed.BodyBytes) != 0 {
		t.Fatal("list exposed full signature payload")
	}

	full, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{
		AuthToken: token, TransactionId: uint32(id),
	}))
	if err != nil {
		t.Fatal("get transaction:", err)
	}
	if len(full.Msg.Transaction.Signatures) != 1 {
		t.Fatalf("detail must retain one signature: %+v", full.Msg.Transaction.Signatures)
	}
	detailed := full.Msg.Transaction.Signatures[0]
	if detailed.Value != value || !bytes.Equal(detailed.BodyBytes, body) {
		t.Fatal("detail lost full signature payload")
	}
}

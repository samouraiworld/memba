package service

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/db"
	"google.golang.org/protobuf/proto"
	_ "modernc.org/sqlite"
)

// testHarness holds a test service instance with in-memory SQLite.
type testHarness struct {
	svc    *MultisigService
	db     *sql.DB
	pubKey ed25519.PublicKey
}

func setup(t *testing.T) *testHarness {
	t.Helper()

	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal("open db:", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}

	// Generate a deterministic keypair using a test seed.
	seed, _ := hex.DecodeString("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	privKey := ed25519.NewKeyFromSeed(seed)
	pubKey := privKey.Public().(ed25519.PublicKey)

	svc := &MultisigService{
		db:         database,
		publicKey:  pubKey,
		privateKey: privKey,
	}

	t.Cleanup(func() { database.Close() })
	return &testHarness{svc: svc, db: database, pubKey: pubKey}
}

// makeToken creates a server-signed token for the given user address.
func (h *testHarness) makeToken(t *testing.T, userAddress string) *membav1.Token {
	t.Helper()
	nonce := make([]byte, 32)
	_, _ = srand.Read(nonce)

	token := &membav1.Token{
		Nonce:       hex.EncodeToString(nonce),
		UserAddress: userAddress,
		Expiration:  time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
	}
	tokenBytes, err := proto.Marshal(token)
	if err != nil {
		t.Fatal("marshal token:", err)
	}
	sig := ed25519.Sign(h.svc.privateKey, tokenBytes)
	// The token stores the signature as base64 via encodeBytes in the real code.
	// ValidateToken uses decodeBytes (base64) to decode. We match that format.
	token.ServerSignature = base64.StdEncoding.EncodeToString(sig)
	return token
}

// seedMultisig inserts a multisig and member directly into the database.
func (h *testHarness) seedMultisig(t *testing.T, chainID, address, pubkeyJSON string, threshold, membersCount int, members []string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := h.db.Exec(
		"INSERT INTO multisigs (chain_id, address, pubkey_json, threshold, members_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		chainID, address, pubkeyJSON, threshold, membersCount, now,
	)
	if err != nil {
		t.Fatal("seed multisig:", err)
	}
	for _, m := range members {
		_, err := h.db.Exec(
			"INSERT INTO user_multisigs (chain_id, user_address, multisig_address, joined, created_at) VALUES (?, ?, ?, TRUE, ?)",
			chainID, m, address, now,
		)
		if err != nil {
			t.Fatal("seed member:", err)
		}
	}
}

func TestAuthenticate_ValidToken(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1testuser123")
	addr, err := h.svc.authenticate(token)
	if err != nil {
		t.Fatal("authenticate:", err)
	}
	if addr != "g1testuser123" {
		t.Fatalf("expected g1testuser123, got %s", addr)
	}
}

func TestAuthenticate_ExpiredToken(t *testing.T) {
	h := setup(t)
	nonce := make([]byte, 32)
	_, _ = srand.Read(nonce)
	token := &membav1.Token{
		Nonce:       hex.EncodeToString(nonce),
		UserAddress: "g1testuser123",
		Expiration:  time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339),
	}
	tokenBytes, _ := proto.Marshal(token)
	sig := ed25519.Sign(h.svc.privateKey, tokenBytes)
	token.ServerSignature = base64.StdEncoding.EncodeToString(sig)

	_, err := h.svc.authenticate(token)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestAuthenticate_NilToken(t *testing.T) {
	h := setup(t)
	_, err := h.svc.authenticate(nil)
	if err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestMultisigs_ListJoinedMultisigs(t *testing.T) {
	h := setup(t)
	user := "g1alice"
	token := h.makeToken(t, user)

	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{user, "g1bob", "g1carol"})
	h.seedMultisig(t, "test11", "g1multisig2", `{}`, 1, 2, []string{user, "g1bob"})

	ctx := context.Background()
	resp, err := h.svc.Multisigs(ctx, connect.NewRequest(&membav1.MultisigsRequest{
		AuthToken: token,
		ChainId:   "test11",
	}))
	if err != nil {
		t.Fatal("Multisigs:", err)
	}
	if len(resp.Msg.Multisigs) != 2 {
		t.Fatalf("expected 2 multisigs, got %d", len(resp.Msg.Multisigs))
	}
}

func TestMultisigs_EmptyForNonMember(t *testing.T) {
	h := setup(t)
	user := "g1stranger"
	token := h.makeToken(t, user)

	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{"g1alice", "g1bob", "g1carol"})

	ctx := context.Background()
	resp, err := h.svc.Multisigs(ctx, connect.NewRequest(&membav1.MultisigsRequest{
		AuthToken: token,
		ChainId:   "test11",
	}))
	if err != nil {
		t.Fatal("Multisigs:", err)
	}
	if len(resp.Msg.Multisigs) != 0 {
		t.Fatalf("expected 0 multisigs, got %d", len(resp.Msg.Multisigs))
	}
}

func TestMultisigInfo_Found(t *testing.T) {
	h := setup(t)
	user := "g1alice"
	token := h.makeToken(t, user)

	h.seedMultisig(t, "test11", "g1multisig1", `{"threshold":2}`, 2, 3, []string{user, "g1bob", "g1carol"})

	ctx := context.Background()
	resp, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{
		AuthToken:       token,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
	}))
	if err != nil {
		t.Fatal("MultisigInfo:", err)
	}
	ms := resp.Msg.Multisig
	if ms.Address != "g1multisig1" {
		t.Fatalf("expected g1multisig1, got %s", ms.Address)
	}
	if ms.Threshold != 2 {
		t.Fatalf("expected threshold 2, got %d", ms.Threshold)
	}
	if len(ms.UsersAddresses) != 3 {
		t.Fatalf("expected 3 members, got %d", len(ms.UsersAddresses))
	}
}

func TestMultisigInfo_NotFound(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")

	ctx := context.Background()
	_, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{
		AuthToken:       token,
		ChainId:         "test11",
		MultisigAddress: "g1nonexistent",
	}))
	if err == nil {
		t.Fatal("expected error for non-existent multisig")
	}
}

func TestTransactionLifecycle(t *testing.T) {
	h := setup(t)
	creator := "g1alice"
	signer := "g1bob"
	creatorToken := h.makeToken(t, creator)
	signerToken := h.makeToken(t, signer)

	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{creator, signer, "g1carol"})

	ctx := context.Background()

	// 1. Create transaction
	createResp, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
		AuthToken:       creatorToken,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
		MsgsJson:        `[{"type":"bank/MsgSend","value":{"amount":[{"denom":"ugnot","amount":"1000000"}]}}]`,
		FeeJson:         `{"gas":"100000","amount":[]}`,
		Memo:            "test tx",
		Type:            "send",
	}))
	if err != nil {
		t.Fatal("CreateTransaction:", err)
	}
	txID := createResp.Msg.TransactionId
	if txID == 0 {
		t.Fatal("expected non-zero tx ID")
	}

	// 2. Sign transaction
	_, err = h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
		AuthToken:     signerToken,
		TransactionId: txID,
		Signature:     "base64sig1",
		BodyBytes:     []byte("bodybytes1"),
	}))
	if err != nil {
		t.Fatal("SignTransaction:", err)
	}

	// 3. Verify signatures loaded in Transactions list (N+1 fix)
	listResp, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken:       creatorToken,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
	}))
	if err != nil {
		t.Fatal("Transactions:", err)
	}
	if len(listResp.Msg.Transactions) != 1 {
		t.Fatalf("expected 1 tx, got %d", len(listResp.Msg.Transactions))
	}
	tx := listResp.Msg.Transactions[0]
	if len(tx.Signatures) != 1 {
		t.Fatalf("expected 1 signature, got %d", len(tx.Signatures))
	}
	if tx.Signatures[0].UserAddress != signer {
		t.Fatalf("expected signer %s, got %s", signer, tx.Signatures[0].UserAddress)
	}

	// 4. Complete transaction
	_, err = h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{
		AuthToken:     creatorToken,
		TransactionId: txID,
		FinalHash:     "0xABCDEF1234567890",
	}))
	if err != nil {
		t.Fatal("CompleteTransaction:", err)
	}

	// 5. Verify executed state
	execResp, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken:      creatorToken,
		ChainId:        "test11",
		ExecutionState: membav1.ExecutionState_EXECUTION_STATE_EXECUTED,
	}))
	if err != nil {
		t.Fatal("Transactions (executed):", err)
	}
	if len(execResp.Msg.Transactions) != 1 {
		t.Fatalf("expected 1 executed tx, got %d", len(execResp.Msg.Transactions))
	}
	if execResp.Msg.Transactions[0].FinalHash != "0xABCDEF1234567890" {
		t.Fatalf("expected hash 0xABCDEF1234567890, got %s", execResp.Msg.Transactions[0].FinalHash)
	}

	// 6. Pending should be empty now
	pendResp, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken:      creatorToken,
		ChainId:        "test11",
		ExecutionState: membav1.ExecutionState_EXECUTION_STATE_PENDING,
	}))
	if err != nil {
		t.Fatal("Transactions (pending):", err)
	}
	if len(pendResp.Msg.Transactions) != 0 {
		t.Fatalf("expected 0 pending tx, got %d", len(pendResp.Msg.Transactions))
	}
}

func TestCreateTransaction_NonMemberRejected(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1stranger")
	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{"g1alice", "g1bob", "g1carol"})

	ctx := context.Background()
	_, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
		AuthToken:       token,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
		MsgsJson:        `[{}]`,
		Type:            "send",
	}))
	if err == nil {
		t.Fatal("expected error for non-member creating tx")
	}
}

func TestSignTransaction_NonMemberRejected(t *testing.T) {
	h := setup(t)
	creator := "g1alice"
	creatorToken := h.makeToken(t, creator)
	strangerToken := h.makeToken(t, "g1stranger")

	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{creator, "g1bob", "g1carol"})

	ctx := context.Background()

	createResp, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
		AuthToken:       creatorToken,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
		MsgsJson:        `[{}]`,
		Type:            "send",
	}))
	if err != nil {
		t.Fatal("CreateTransaction:", err)
	}

	_, err = h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
		AuthToken:     strangerToken,
		TransactionId: createResp.Msg.TransactionId,
		Signature:     "sig",
	}))
	if err == nil {
		t.Fatal("expected error for non-member signing tx")
	}
}

func TestCreateTransaction_InputLimits(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{"g1alice", "g1bob", "g1carol"})

	ctx := context.Background()

	// Oversized memo (>256 chars)
	longMemo := make([]byte, 300)
	for i := range longMemo {
		longMemo[i] = 'A'
	}
	_, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
		AuthToken:       token,
		ChainId:         "test11",
		MultisigAddress: "g1multisig1",
		MsgsJson:        `[{}]`,
		Memo:            string(longMemo),
		Type:            "send",
	}))
	if err == nil {
		t.Fatal("expected error for oversized memo")
	}
}

func TestBatchSignatureLoading(t *testing.T) {
	h := setup(t)
	user := "g1alice"
	token := h.makeToken(t, user)
	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 2, 3, []string{user, "g1bob", "g1carol"})

	ctx := context.Background()

	// Create 3 transactions and sign each with different signers.
	for i := 0; i < 3; i++ {
		resp, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
			AuthToken:       token,
			ChainId:         "test11",
			MultisigAddress: "g1multisig1",
			MsgsJson:        `[{}]`,
			Type:            "send",
		}))
		if err != nil {
			t.Fatal("CreateTransaction:", err)
		}

		// Sign with bob
		bobToken := h.makeToken(t, "g1bob")
		_, err = h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
			AuthToken:     bobToken,
			TransactionId: resp.Msg.TransactionId,
			Signature:     "bobsig",
		}))
		if err != nil {
			t.Fatal("SignTransaction (bob):", err)
		}

		// Sign with carol
		carolToken := h.makeToken(t, "g1carol")
		_, err = h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
			AuthToken:     carolToken,
			TransactionId: resp.Msg.TransactionId,
			Signature:     "carolsig",
		}))
		if err != nil {
			t.Fatal("SignTransaction (carol):", err)
		}
	}

	// List transactions — all sigs should be batch-loaded.
	listResp, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken: token,
		ChainId:   "test11",
	}))
	if err != nil {
		t.Fatal("Transactions:", err)
	}
	if len(listResp.Msg.Transactions) != 3 {
		t.Fatalf("expected 3 txs, got %d", len(listResp.Msg.Transactions))
	}
	for _, tx := range listResp.Msg.Transactions {
		if len(tx.Signatures) != 2 {
			t.Fatalf("tx %d: expected 2 sigs, got %d", tx.Id, len(tx.Signatures))
		}
	}
}

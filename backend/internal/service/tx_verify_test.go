package service

// Hash normalization, and the CompleteTransaction contract for legacy
// (non-native) multisig records.

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"github.com/cosmos/cosmos-sdk/codec/legacy"
	cosmosms "github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	cosmossecp "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/gnomultisig"
)

const hexHash = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899"

func TestNormalizeTxHashHex(t *testing.T) {
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i)
	}
	b64 := base64.StdEncoding.EncodeToString(raw)

	cases := []struct {
		name, in, want string
		wantErr        bool
	}{
		{"bare hex", hexHash, hexHash, false},
		{"0x hex", "0x" + strings.ToLower(hexHash), hexHash, false},
		{"base64 of 32 bytes (Adena shape)", b64, "000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F", false},
		{"garbage", "0xSHOULDFAIL", "", true},
		{"base64 of wrong length", base64.StdEncoding.EncodeToString([]byte("short")), "", true},
		{"empty", "", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := normalizeTxHashHex(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatalf("want error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("want %s, got %s", c.want, got)
			}
		})
	}
}

// legacyTestIdentity builds a realistic legacy record: a Cosmos
// LegacyAminoPubKey-derived 2-of-3 identity over the same member keys the native
// tests use. Such an address cannot execute transactions on Gno.
func legacyTestIdentity(t *testing.T) (address, pubkeyJSON string, members []string) {
	t.Helper()
	_, keys, _ := nativeTestIdentity(t)
	cp := make([]cryptotypes.PubKey, len(keys))
	members = make([]string, len(keys))
	for i, k := range keys {
		p := k.PubKey().(secp256k1.PubKeySecp256k1)
		cp[i] = &cosmossecp.PubKey{Key: p[:]}
		members[i] = k.PubKey().Address().String()
	}
	pk := cosmosms.NewLegacyAminoPubKey(2, cp)
	j, err := legacy.Cdc.MarshalJSON(pk)
	if err != nil {
		t.Fatal(err)
	}
	address, err = bech32.ConvertAndEncode("g", pk.Address())
	if err != nil {
		t.Fatal(err)
	}
	if gnomultisig.IsNative(string(j)) {
		t.Fatal("legacy identity classified as native")
	}
	return address, string(j), members
}

// legacyFixture seeds a legacy 2-of-3 record and a proposal signed by members 0
// and 1 (quorum reached in the legacy count-only sense).
type legacyFixture struct {
	h       *testHarness
	chainID string
	address string
	members []string
	txID    uint32
}

func newLegacyFixture(t *testing.T) *legacyFixture {
	t.Helper()
	// Log-only A3 mode (the production default): unverified signature rows count.
	t.Setenv("MEMBA_ENFORCE_MULTISIG_SIG_VERIFY", "")
	h := setup(t)
	f := &legacyFixture{h: h, chainID: "legacy-local"}
	var pubkeyJSON string
	f.address, pubkeyJSON, f.members = legacyTestIdentity(t)
	h.seedMultisig(t, f.chainID, f.address, pubkeyJSON, 2, 3, f.members)
	ctx := context.Background()
	created, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
		AuthToken:       h.makeToken(t, f.members[0]),
		ChainId:         f.chainID,
		MultisigAddress: f.address,
		MsgsJson:        `[{"@type":"/bank.MsgSend"}]`,
		FeeJson:         `{"gas_wanted":"100000","gas_fee":"10000ugnot"}`,
		Memo:            "legacy",
		Type:            "send",
	}))
	if err != nil {
		t.Fatal("CreateTransaction:", err)
	}
	f.txID = created.Msg.TransactionId
	for _, m := range f.members[:2] {
		if err := f.sign(t, m); err != nil {
			t.Fatal("SignTransaction:", err)
		}
	}
	return f
}

func (f *legacyFixture) sign(t *testing.T, member string) error {
	t.Helper()
	_, err := f.h.svc.SignTransaction(context.Background(), connect.NewRequest(&membav1.SignTransactionRequest{
		AuthToken:     f.h.makeToken(t, member),
		TransactionId: f.txID,
		Signature:     "sig-" + member,
		BodyBytes:     []byte("bb"),
	}))
	return err
}

func (f *legacyFixture) complete(t *testing.T, member, hash string) error {
	t.Helper()
	_, err := f.h.svc.CompleteTransaction(context.Background(), connect.NewRequest(&membav1.CompleteTransactionRequest{
		AuthToken: f.h.makeToken(t, member), TransactionId: f.txID, FinalHash: hash,
	}))
	return err
}

// assertPending checks the stored row directly: no final hash, not verified,
// and still returned by the pending listing.
func (f *legacyFixture) assertPending(t *testing.T) {
	t.Helper()
	var finalHash *string
	var verified bool
	if err := f.h.db.QueryRow("SELECT final_hash, verified FROM transactions WHERE id = ?", f.txID).Scan(&finalHash, &verified); err != nil {
		t.Fatal(err)
	}
	if finalHash != nil || verified {
		t.Fatalf("legacy row mutated: final_hash=%v verified=%v", finalHash, verified)
	}
	resp, err := f.h.svc.Transactions(context.Background(), connect.NewRequest(&membav1.TransactionsRequest{
		AuthToken:       f.h.makeToken(t, f.members[0]),
		ChainId:         f.chainID,
		MultisigAddress: f.address,
		ExecutionState:  membav1.ExecutionState_EXECUTION_STATE_PENDING,
	}))
	if err != nil {
		t.Fatal("Transactions (pending):", err)
	}
	if len(resp.Msg.Transactions) != 1 || resp.Msg.Transactions[0].Id != f.txID {
		t.Fatalf("want the legacy proposal still pending, got %d rows", len(resp.Msg.Transactions))
	}
}

// Legacy records are read-only history for completion: a member at quorum
// cannot attach a hash, even one the configured RPC reports as existing, and
// no RPC is consulted on their behalf.
func TestCompleteTransactionLegacyUnrelatedHashRejected(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte(`{"result":{"hash":"` + hexHash + `","height":"42"}}`))
	}))
	defer srv.Close()
	t.Setenv("QUEST_RPC_URL", srv.URL)

	f := newLegacyFixture(t)
	// A non-creator member who did not sign.
	err := f.complete(t, f.members[2], hexHash)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("want FailedPrecondition, got %v", err)
	}
	f.assertPending(t)
	if n := hits.Load(); n != 0 {
		t.Fatalf("legacy completion consulted an RPC %d time(s)", n)
	}
	// The record stays usable as history: another member can still sign.
	if err := f.sign(t, f.members[2]); err != nil {
		t.Fatal("SignTransaction after refused completion:", err)
	}
	f.assertPending(t)
}

func TestCompleteTransactionLegacyUnverifiableKeepsPending(t *testing.T) {
	cases := []struct {
		name    string
		hash    string
		handler http.HandlerFunc
	}{
		{"malformed hash", "0xNOT-A-REAL-HASH", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"result":{"hash":"` + hexHash + `","height":"42"}}`))
		}},
		{"not found", hexHash, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"error":{"code":-32603,"message":"Internal error","data":"tx (` + hexHash + `) not found"}}`))
		}},
		{"http 500", hexHash, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(c.handler)
			defer srv.Close()
			t.Setenv("QUEST_RPC_URL", srv.URL)

			f := newLegacyFixture(t)
			if err := f.complete(t, f.members[0], c.hash); err == nil {
				t.Fatal("legacy completion with an unverifiable hash must fail")
			}
			f.assertPending(t)
		})
	}
}

// Legacy completion is refused whatever the chain lookup would say: a hash the
// RPC confirms and a malformed one both leave the row pending and unverified.
// (Before this contract, the first stored verified=true and the second stored
// verified=false; verified=true is now only set by the native receipt check.)
func TestCompleteTransactionVerifiedFlag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"hash":"` + hexHash + `","height":"42"}}`))
	}))
	defer srv.Close()
	t.Setenv("QUEST_RPC_URL", srv.URL)

	h := setup(t)
	creator := "g1alice"
	creatorToken := h.makeToken(t, creator)
	h.seedMultisig(t, "test11", "g1multisig1", `{}`, 1, 2, []string{creator, "g1bob"})
	ctx := context.Background()

	mkTx := func(memo string) uint32 {
		resp, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
			AuthToken:       creatorToken,
			ChainId:         "test11",
			MultisigAddress: "g1multisig1",
			MsgsJson:        `[{"@type":"/bank.MsgSend"}]`,
			FeeJson:         `{"gas_wanted":"100000","gas_fee":"10000ugnot"}`,
			Memo:            memo,
			Type:            "send",
		}))
		if err != nil {
			t.Fatal("CreateTransaction:", err)
		}
		if _, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
			AuthToken:     creatorToken,
			TransactionId: resp.Msg.TransactionId,
			Signature:     "sig-" + memo,
			BodyBytes:     []byte("bb"),
		})); err != nil {
			t.Fatal("SignTransaction:", err)
		}
		return resp.Msg.TransactionId
	}

	stateOf := func(txID uint32) (string, bool) {
		resp, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{
			AuthToken:     creatorToken,
			TransactionId: txID,
		}))
		if err != nil {
			t.Fatal("GetTransaction:", err)
		}
		return resp.Msg.Transaction.FinalHash, resp.Msg.Transaction.Verified
	}

	for _, c := range []struct{ memo, hash string }{
		{"a", hexHash},             // (a) hash the RPC confirms
		{"b", "0xNOT-A-REAL-HASH"}, // (b) malformed hash
	} {
		txID := mkTx(c.memo)
		_, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{
			AuthToken: creatorToken, TransactionId: txID, FinalHash: c.hash,
		}))
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("(%s) want FailedPrecondition for a legacy record, got %v", c.memo, err)
		}
		if hash, verified := stateOf(txID); hash != "" || verified {
			t.Fatalf("(%s) legacy row mutated: final_hash=%q verified=%v", c.memo, hash, verified)
		}
	}
}

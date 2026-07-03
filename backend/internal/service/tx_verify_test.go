package service

// W2.3 (BE-3) — hash normalization + best-effort chain reconcile of the
// client-supplied final_hash, and the CompleteTransaction verified flag.

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
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

func TestTxExistsOnChain(t *testing.T) {
	ctx := context.Background()

	t.Run("found on-chain", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/tx") {
				t.Errorf("unexpected path %s", r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"result":{"hash":"` + hexHash + `","height":"123"}}`))
		}))
		defer srv.Close()
		ok, err := txExistsOnChain(ctx, srv.URL, hexHash)
		if err != nil || !ok {
			t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
		}
	})

	t.Run("chain answers not-found: definitive false, no error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"error":{"code":-32603,"message":"Internal error","data":"tx (` + hexHash + `) not found"}}`))
		}))
		defer srv.Close()
		ok, err := txExistsOnChain(ctx, srv.URL, hexHash)
		if err != nil || ok {
			t.Fatalf("want (false,nil), got (%v,%v)", ok, err)
		}
	})

	t.Run("other RPC error: availability failure, not a verdict", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"error":{"code":-32603,"message":"Internal error","data":"storage fault"}}`))
		}))
		defer srv.Close()
		_, err := txExistsOnChain(ctx, srv.URL, hexHash)
		if err == nil {
			t.Fatal("want error for non-not-found RPC error")
		}
	})

	t.Run("endpoint unreachable: error", func(t *testing.T) {
		_, err := txExistsOnChain(ctx, "http://127.0.0.1:1", hexHash)
		if err == nil {
			t.Fatal("want transport error")
		}
	})
}

// The full flag behavior through the real RPC handler: a resolvable hash marks
// the row verified=true; an unverifiable one completes anyway with
// verified=false (availability never blocks completion).
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

	verifiedOf := func(txID uint32) bool {
		resp, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{
			AuthToken:     creatorToken,
			TransactionId: txID,
		}))
		if err != nil {
			t.Fatal("GetTransaction:", err)
		}
		return resp.Msg.Transaction.Verified
	}

	// (a) resolvable hash → verified=true
	txA := mkTx("a")
	if _, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{
		AuthToken: creatorToken, TransactionId: txA, FinalHash: hexHash,
	})); err != nil {
		t.Fatal("CompleteTransaction (verifiable):", err)
	}
	if !verifiedOf(txA) {
		t.Fatal("want verified=true for a hash the chain confirms")
	}

	// (b) malformed hash → completes, verified=false (never blocks)
	txB := mkTx("b")
	if _, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{
		AuthToken: creatorToken, TransactionId: txB, FinalHash: "0xNOT-A-REAL-HASH",
	})); err != nil {
		t.Fatal("CompleteTransaction (unverifiable) must still succeed:", err)
	}
	if verifiedOf(txB) {
		t.Fatal("want verified=false for an unverifiable hash")
	}
}

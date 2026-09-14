package service

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"github.com/cosmos/cosmos-sdk/codec/legacy"
	cosmosms "github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	cosmossecp "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"github.com/gnolang/gno/tm2/pkg/amino"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/multisig"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/gnomultisig"
	"google.golang.org/protobuf/proto"
)

func nativeTestIdentity(t *testing.T) (multisig.PubKeyMultisigThreshold, []secp256k1.PrivKeySecp256k1, string) {
	t.Helper()
	keys := make([]secp256k1.PrivKeySecp256k1, 3)
	pubs := make([]crypto.PubKey, 3)
	for i := range keys {
		keys[i][31] = byte(i + 1)
		pubs[i] = keys[i].PubKey()
	}
	pk := multisig.NewPubKeyMultisigThreshold(2, pubs).(multisig.PubKeyMultisigThreshold)
	j, err := gnomultisig.JSON(pk)
	if err != nil {
		t.Fatal(err)
	}
	return pk, keys, j
}

func nativeTestToken(t *testing.T, h *testHarness, address string) *membav1.Token {
	t.Helper()
	token := h.makeToken(t, address)
	token.ChainId = h.svc.chainID
	token.ServerSignature = ""
	b, err := proto.Marshal(token)
	if err != nil {
		t.Fatal(err)
	}
	token.ServerSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(h.svc.privateKey, b))
	return token
}

func snapshotIdentityHistory(t *testing.T, h *testHarness) string {
	t.Helper()
	all := map[string][][]any{}
	for _, table := range []string{"multisigs", "transactions", "signatures"} {
		// Constant test-only table names, not request input.
		rows, err := h.db.Query("SELECT * FROM " + table + " ORDER BY 1,2")
		if err != nil {
			t.Fatal(err)
		}
		cols, err := rows.Columns()
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			values := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			all[table] = append(all[table], values)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
	}
	b, err := json.Marshal(all)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestNativeLifecycleAndLegacyPreservation(t *testing.T) {
	h := setup(t)
	h.svc.chainID = "native-local"
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	pk, keys, j := nativeTestIdentity(t)
	addr := pk.Address().String()
	ctx := context.Background()
	token := nativeTestToken(t, h, keys[0].PubKey().Address().String())
	request := &membav1.CreateOrJoinMultisigRequest{AuthToken: token, ChainId: h.svc.chainID, MultisigPubkeyJson: j, ExpectedMultisigAddress: addr, Bech32Prefix: "g", Name: "native exact-order import"}
	// Closed by default and wrong preview identities cannot write anything.
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "")
	if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(request)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatal(err)
	}
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	request.ExpectedMultisigAddress = "g1wrong"
	if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(request)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatal(err)
	}
	request.ExpectedMultisigAddress = addr
	r, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(request))
	if err != nil || !r.Msg.Created || r.Msg.MultisigAddress != addr {
		t.Fatalf("create: %v %v", r, err)
	}
	request.NativeCreate = true
	if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(request)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("unsorted new create: %v", err)
	}
	request.NativeCreate = false
	// A legacy sibling has the SAME ordered keys, not the native address.
	cp := make([]cryptotypes.PubKey, len(keys))
	for i, k := range keys {
		p := k.PubKey().(secp256k1.PubKeySecp256k1)
		cp[i] = &cosmossecp.PubKey{Key: p[:]}
	}
	legacyPK := cosmosms.NewLegacyAminoPubKey(2, cp)
	lj, err := legacy.Cdc.MarshalJSON(legacyPK)
	if err != nil {
		t.Fatal(err)
	}
	la, err := bech32.ConvertAndEncode("g", legacyPK.Address())
	if err != nil {
		t.Fatal(err)
	}
	if la == addr {
		t.Fatal("identities collapsed")
	}
	members := []string{keys[0].PubKey().Address().String(), keys[1].PubKey().Address().String(), keys[2].PubKey().Address().String()}
	h.seedMultisig(t, h.svc.chainID, la, string(lj), 2, 3, members)
	if _, err := h.db.Exec(`INSERT INTO transactions(id,chain_id,multisig_address,msgs_json,fee_json,account_number,sequence,memo,creator_address) VALUES(999,?,?,?,?,?,?,?,?)`, h.svc.chainID, la, "old bytes", "old fee", 17, 23, "keep me", members[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.Exec(`INSERT INTO signatures(transaction_id,user_address,signature,body_bytes,verified) VALUES(999,?,?,?,TRUE)`, members[0], "existing-signature", []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.Exec(`INSERT INTO transactions(id,chain_id,multisig_address,msgs_json,fee_json,account_number,sequence,memo,creator_address,final_hash,verified) VALUES(1000,?,?,?,?,?,?,?,?,?,TRUE)`, h.svc.chainID, la, "executed bytes", "executed fee", 17, 22, "keep executed history", members[0], "existing-final-hash"); err != nil {
		t.Fatal(err)
	}
	before := snapshotIdentityHistory(t, h)
	for _, identity := range []struct{ address, json string }{{addr, j}, {la, string(lj)}} {
		for _, member := range members {
			req := &membav1.CreateOrJoinMultisigRequest{AuthToken: nativeTestToken(t, h, member), ChainId: h.svc.chainID, MultisigPubkeyJson: identity.json, ExpectedMultisigAddress: identity.address, Bech32Prefix: "g", Name: "renamed"}
			if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(req)); err != nil {
				t.Fatal(err)
			}
			// Old clients omit the new identity hint for existing legacy records.
			if identity.address == la {
				req.ExpectedMultisigAddress = ""
				if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(req)); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if got := snapshotIdentityHistory(t, h); got != before {
		t.Fatal("wallet identity, history or signatures changed during join/rename")
	}
}

func TestNativeNewCreationCanonicalOrder(t *testing.T) {
	h := setup(t)
	h.svc.chainID = "native-local"
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	pk, keys, _ := nativeTestIdentity(t)
	slices.SortFunc(pk.PubKeys, func(a, b crypto.PubKey) int { aa, bb := a.Address(), b.Address(); return bytes.Compare(aa[:], bb[:]) })
	j, err := gnomultisig.JSON(pk)
	if err != nil {
		t.Fatal(err)
	}
	res, err := h.svc.CreateOrJoinMultisig(context.Background(), connect.NewRequest(&membav1.CreateOrJoinMultisigRequest{AuthToken: nativeTestToken(t, h, keys[0].PubKey().Address().String()), ChainId: h.svc.chainID, MultisigPubkeyJson: j, ExpectedMultisigAddress: pk.Address().String(), Bech32Prefix: "g", NativeCreate: true}))
	if err != nil || !res.Msg.Created || res.Msg.MultisigAddress != pk.Address().String() {
		t.Fatalf("new canonical creation: %v %v", res, err)
	}
	var stored string
	if err := h.db.QueryRow("SELECT pubkey_json FROM multisigs WHERE address = ?", pk.Address().String()).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != j {
		t.Fatal("registered key order changed")
	}
}

func TestNativeProposalSignExport(t *testing.T) {
	h := setup(t)
	h.svc.chainID = "native-local"
	t.Setenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG", "true")
	t.Setenv("MEMBA_ENFORCE_MULTISIG_SIG_VERIFY", "false")
	pk, keys, j := nativeTestIdentity(t)
	addr := pk.Address().String()
	ctx := context.Background()
	for _, key := range keys {
		if _, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(&membav1.CreateOrJoinMultisigRequest{AuthToken: nativeTestToken(t, h, key.PubKey().Address().String()), ChainId: h.svc.chainID, MultisigPubkeyJson: j, ExpectedMultisigAddress: addr, Bech32Prefix: "g"})); err != nil {
			t.Fatal(err)
		}
	}
	token := nativeTestToken(t, h, keys[0].PubKey().Address().String())
	request := &membav1.CreateTransactionRequest{AuthToken: token, ChainId: h.svc.chainID, MultisigAddress: addr, MsgsJson: fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot"}]`, addr, keys[0].PubKey().Address()), FeeJson: `{"gas_wanted":"1000000","gas_fee":"100000ugnot"}`, AccountNumber: 7, Sequence: 3}
	created, err := h.svc.CreateTransaction(ctx, connect.NewRequest(request))
	if err != nil {
		t.Fatal(err)
	}
	id := created.Msg.TransactionId
	get := func() *membav1.GetTransactionResponse {
		r, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{AuthToken: token, TransactionId: id}))
		if err != nil {
			t.Fatal(err)
		}
		return r.Msg
	}
	if len(get().NativeTxBytes) != 0 {
		t.Fatal("unsigned transaction exported as ready")
	}
	f := nativeFields(get().Transaction)
	unsigned, err := gnomultisig.Transaction(f, addr)
	if err != nil {
		t.Fatal(err)
	}
	submit := func(i int, legacy bool, bad bool) error {
		b, err := unsigned.GetSignBytes(f.ChainID, f.AccountNumber, f.Sequence)
		if legacy {
			b, err = unsigned.GetSignBytesLegacy(f.ChainID, f.AccountNumber, f.Sequence)
		}
		if err != nil {
			t.Fatal(err)
		}
		sig, err := keys[i].Sign(b)
		if err != nil {
			t.Fatal(err)
		}
		if bad {
			sig = make([]byte, 64)
		}
		_, err = h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: nativeTestToken(t, h, keys[i].PubKey().Address().String()), TransactionId: id, Signature: base64.StdEncoding.EncodeToString(sig), BodyBytes: []byte("untrusted body ignored")}))
		return err
	}
	if err := submit(0, false, true); err == nil {
		t.Fatal("bad native signature accepted in legacy log-only mode")
	}
	if err := submit(2, false, false); err != nil {
		t.Fatal(err)
	}
	if err := submit(0, true, false); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("mixed fee rendering: %v", err)
	}
	if err := submit(0, false, false); err != nil {
		t.Fatal(err)
	}
	ready := get()
	if len(ready.NativeTxBytes) == 0 || ready.NativeTxJson == "" || ready.NativeExportError != "" {
		t.Fatalf("missing artifact: %+v", ready)
	}
	if _, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: token, TransactionId: id, FinalHash: "forged"})); err == nil {
		t.Fatal("completed without a verified native receipt")
	}
	if get().Transaction.FinalHash != "" {
		t.Fatal("failed completion mutated history")
	}
	request.MsgsJson = fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot"}]`, keys[0].PubKey().Address(), addr)
	if _, err := h.svc.CreateTransaction(ctx, connect.NewRequest(request)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("wrong signer: %v", err)
	}
	// Reconcile against an isolated RPC stub using native result serialization.
	hash := sha256.Sum256(ready.NativeTxBytes)
	status := ctypes.ResultStatus{}
	status.NodeInfo.Network = h.svc.chainID
	receipt := ctypes.ResultTx{Hash: hash[:], Height: 1, Tx: ready.NativeTxBytes}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Method string          `json:"method"`
			ID     json.RawMessage `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			w.WriteHeader(400)
			return
		}
		var result any = receipt
		if request.Method == "status" {
			result = status
		}
		encoded, err := amino.MarshalJSON(result)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		if err := json.NewEncoder(w).Encode(struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Result  json.RawMessage `json:"result"`
		}{"2.0", request.ID, encoded}); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	t.Setenv("MEMBA_NATIVE_GNO_RPC_URL", server.URL)
	// A third member may submit while the already-exported 2-of-3 transaction
	// is being broadcast. Reconciliation must recognize that valid receipt.
	if err := submit(1, false, false); err != nil {
		t.Fatal(err)
	}
	complete := func() error {
		_, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: token, TransactionId: id, FinalHash: fmtHash(hash[:])}))
		return err
	}
	status.NodeInfo.Network = "wrong-chain"
	if err := complete(); err == nil {
		t.Fatal("wrong RPC chain accepted")
	}
	status.NodeInfo.Network = h.svc.chainID
	receipt.TxResult.Error = abci.StringError("test rejection")
	if err := complete(); err == nil {
		t.Fatal("failed DeliverTx accepted")
	}
	receipt.TxResult.Error = nil
	receipt.Tx = []byte("different bytes")
	if err := complete(); err == nil {
		t.Fatal("unrelated receipt accepted")
	}
	receipt.Tx = ready.NativeTxBytes
	if err := complete(); err != nil {
		t.Fatalf("valid native receipt rejected: %v", err)
	}
	if final := get().Transaction; final.FinalHash != fmtHash(hash[:]) || !final.Verified {
		t.Fatal("native receipt not recorded")
	}
}

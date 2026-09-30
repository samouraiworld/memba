package service

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/cosmos/cosmos-sdk/codec/legacy"
	cosmosms "github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	cosmossecp "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	dsecp "github.com/decred/dcrd/dcrec/secp256k1/v4"
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
	// How the node answers a Tx lookup: with the receipt, with its own
	// "no such transaction" error, with another error, or with no answer. And
	// the multisig account it holds, which says whether a sequence was used.
	txAnswer := "receipt"
	accountSequence := "0"
	account := func() []byte {
		if accountSequence == "unreadable" {
			return []byte("null")
		}
		if accountSequence == "another account" {
			return []byte(fmt.Sprintf(`{"BaseAccount":{"address":%q,"sequence":"9"}}`, keys[0].PubKey().Address()))
		}
		return []byte(fmt.Sprintf(`{"BaseAccount":{"address":%q,"coins":"","public_key":null,"account_number":"7","sequence":%q}}`, addr, accountSequence))
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Method string          `json:"method"`
			ID     json.RawMessage `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			w.WriteHeader(400)
			return
		}
		reply := struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Result  json.RawMessage `json:"result,omitempty"`
			Error   any             `json:"error,omitempty"`
		}{JSONRPC: "2.0", ID: request.ID}
		var result any = receipt
		switch {
		case request.Method == "status":
			result = status
		case request.Method == "abci_query":
			result = ctypes.ResultABCIQuery{Response: abci.ResponseQuery{ResponseBase: abci.ResponseBase{Data: account()}}}
		case txAnswer == "absent":
			reply.Error = map[string]any{"code": -32603, "message": "Internal error", "data": "Could not find tx result for hash #" + fmtHash(hash[:])}
		case txAnswer == "absent for another hash":
			reply.Error = map[string]any{"code": -32603, "message": "Internal error", "data": "Could not find tx result for hash #" + strings.Repeat("A", 64)}
		case txAnswer == "node error":
			reply.Error = map[string]any{"code": -32603, "message": "Internal error", "data": "block not found for height 12"}
		case txAnswer == "no answer":
			w.WriteHeader(502)
			return
		}
		if reply.Error == nil {
			encoded, err := amino.MarshalJSON(result)
			if err != nil {
				w.WriteHeader(500)
				return
			}
			reply.Result = encoded
		}
		if err := json.NewEncoder(w).Encode(reply); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	t.Setenv("MEMBA_NATIVE_GNO_RPC_URL", server.URL)
	// At exactly the quorum, an earliest signer cannot replace its signature.
	quorumBytes, err := unsigned.GetSignBytes(f.ChainID, f.AccountNumber, f.Sequence)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: nativeTestToken(t, h, keys[0].PubKey().Address().String()), TransactionId: id, Signature: base64.StdEncoding.EncodeToString(randomNonceSign(t, keys[0], quorumBytes))})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a signature replaced at quorum: %v", err)
	}
	// A third member may submit while the 2-of-3 transaction is being
	// broadcast: the aggregate keeps the two earliest signatures, so its bytes
	// and hash do not change once quorum is reached.
	if err := submit(1, false, false); err != nil {
		t.Fatal(err)
	}
	if after := get(); !bytes.Equal(after.NativeTxBytes, ready.NativeTxBytes) || len(after.Transaction.Signatures) != 3 {
		t.Fatal("a signature after quorum changed the transaction")
	}
	// Nor can one of the earliest signers replace its signature, even with
	// another valid one (a wallet that does not sign deterministically).
	signBytes, err := unsigned.GetSignBytes(f.ChainID, f.AccountNumber, f.Sequence)
	if err != nil {
		t.Fatal(err)
	}
	for _, sig := range [][]byte{randomNonceSign(t, keys[0], signBytes), mustSign(t, keys[0], signBytes)} {
		_, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: nativeTestToken(t, h, keys[0].PubKey().Address().String()), TransactionId: id, Signature: base64.StdEncoding.EncodeToString(sig)}))
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("a signature replaced after quorum: %v", err)
		}
	}
	if !bytes.Equal(get().NativeTxBytes, ready.NativeTxBytes) {
		t.Fatal("a refused replacement changed the transaction")
	}
	complete := func() error {
		_, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: token, TransactionId: id, FinalHash: fmtHash(hash[:])}))
		return err
	}
	status.NodeInfo.Network = "wrong-chain"
	if err := complete(); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("wrong RPC chain: %v", err)
	}
	status.NodeInfo.Network = h.svc.chainID
	// Only the node's own "no such transaction" lets a client broadcast.
	for answer, want := range map[string]connect.Code{"absent": connect.CodeFailedPrecondition, "absent for another hash": connect.CodeUnavailable, "node error": connect.CodeUnavailable, "no answer": connect.CodeUnavailable} {
		txAnswer = answer
		if err := complete(); connect.CodeOf(err) != want {
			t.Fatalf("node answer %q: %v, want %v", answer, err, want)
		}
	}
	txAnswer = "receipt"
	// A node whose receipt is not for the hash asked about has not answered.
	receipt.Tx = []byte("different bytes")
	if err := complete(); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("receipt for another hash: %v", err)
	}
	receipt.Tx = ready.NativeTxBytes
	receipt.Height = 0
	if err := complete(); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("uncommitted receipt: %v", err)
	}
	receipt.Height = 1
	// A committed receipt of another transaction: this proposal is not there.
	other := []byte("another transaction")
	otherHash := sha256.Sum256(other)
	receipt = ctypes.ResultTx{Hash: otherHash[:], Height: 1, Tx: other}
	if _, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: token, TransactionId: id, FinalHash: fmtHash(otherHash[:])})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("receipt of another transaction: %v", err)
	}
	receipt = ctypes.ResultTx{Hash: hash[:], Height: 1, Tx: ready.NativeTxBytes}
	if get().Transaction.FinalHash != "" {
		t.Fatal("a refused completion mutated history")
	}
	// A refusal before execution first, then the same bytes executed: the
	// kept reason goes when the transaction runs.
	receipt.TxResult.Error = abci.StringError("insufficient fee")
	accountSequence = "3"
	if err := complete(); connect.CodeOf(err) != connect.CodeFailedPrecondition || get().Transaction.OnchainError == "" {
		t.Fatalf("a refusal before execution: %v", err)
	}
	receipt.TxResult.Error = nil
	if err := complete(); err != nil {
		t.Fatalf("valid native receipt rejected: %v", err)
	}
	if final := get().Transaction; final.FinalHash != fmtHash(hash[:]) || !final.Verified || final.OnchainError != "" {
		t.Fatal("native receipt not recorded")
	}

	// A proposal whose transaction the chain executed and refused is closed as
	// failed, with the chain's reason: its sequence is used, so it can never
	// run again and must not stay ready to broadcast.
	request.MsgsJson = fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot"}]`, addr, keys[0].PubKey().Address())
	request.Sequence = 4
	second, err := h.svc.CreateTransaction(ctx, connect.NewRequest(request))
	if err != nil {
		t.Fatal(err)
	}
	id = second.Msg.TransactionId
	f = nativeFields(get().Transaction)
	if unsigned, err = gnomultisig.Transaction(f, addr); err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{0, 2} {
		if err := submit(i, false, false); err != nil {
			t.Fatal(err)
		}
	}
	failed := get()
	hash = sha256.Sum256(failed.NativeTxBytes)
	receipt = ctypes.ResultTx{Hash: hash[:], Height: 2, Tx: failed.NativeTxBytes}
	receipt.TxResult.Error = abci.StringError("insufficient fee")
	receipt.TxResult.Log = "gas price rose"
	// Refused before execution: the account's sequence is still the
	// proposal's, so the signed bytes stay valid. The reason is kept and the
	// proposal stays open; the answer lets the client broadcast again.
	accountSequence = "4"
	if err := complete(); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a refusal before execution: %v", err)
	}
	open := get()
	if open.Transaction.FinalHash != "" || open.Transaction.OnchainError != "insufficient fee: gas price rose" || !bytes.Equal(open.NativeTxBytes, failed.NativeTxBytes) {
		t.Fatalf("a refusal before execution closed the proposal or lost its reason: %+v", open.Transaction)
	}
	for _, unreadable := range []string{"unreadable", "another account"} {
		accountSequence = unreadable
		if err := complete(); connect.CodeOf(err) != connect.CodeUnavailable {
			t.Fatalf("account %s: %v", unreadable, err)
		}
	}
	// Refused while running its messages: the sequence is used, so the
	// proposal can never run and is closed as failed, with the chain's reason.
	accountSequence = "5"
	// Long, and cut through a two-byte character at the bound.
	receipt.TxResult.Error = abci.StringError("insufficient coins")
	receipt.TxResult.Log = strings.Repeat("x", maxOnchainError-20) + strings.Repeat("é", 300)
	if err := complete(); err != nil {
		t.Fatalf("executed and refused transaction not recorded: %v", err)
	}
	closed := get().Transaction
	if closed.FinalHash != fmtHash(hash[:]) || closed.Verified || !strings.HasPrefix(closed.OnchainError, "insufficient coins: xxx") ||
		len(closed.OnchainError) > maxOnchainError+len("...") || !utf8.ValidString(closed.OnchainError) {
		t.Fatalf("failure not recorded: %+v", closed)
	}
	if len(get().NativeTxBytes) != 0 {
		t.Fatal("a failed proposal is still offered for broadcast")
	}
	if err := submit(1, false, false); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a failed proposal took a signature: %v", err)
	}
	if err := complete(); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a failed proposal was completed again: %v", err)
	}
}

func mustSign(t *testing.T, key secp256k1.PrivKeySecp256k1, msg []byte) []byte {
	t.Helper()
	sig, err := key.Sign(msg)
	if err != nil {
		t.Fatal(err)
	}
	return sig
}

// randomNonceSign is a valid low-S secp256k1 signature with a random nonce,
// as a wallet that does not follow RFC 6979 would produce.
func randomNonceSign(t *testing.T, key secp256k1.PrivKeySecp256k1, msg []byte) []byte {
	t.Helper()
	n := dsecp.Params().N
	digest := sha256.Sum256(msg)
	z := new(big.Int).SetBytes(digest[:])
	d := new(big.Int).SetBytes(key[:])
	for {
		k, err := rand.Int(rand.Reader, n)
		if err != nil || k.Sign() == 0 {
			continue
		}
		var ks dsecp.ModNScalar
		ks.SetByteSlice(k.FillBytes(make([]byte, 32)))
		var point dsecp.JacobianPoint
		dsecp.ScalarBaseMultNonConst(&ks, &point)
		point.ToAffine()
		r := new(big.Int).Mod(new(big.Int).SetBytes(point.X.Bytes()[:]), n)
		if r.Sign() == 0 {
			continue
		}
		s := new(big.Int).Mul(r, d)
		s.Add(s, z)
		s.Mul(s, new(big.Int).ModInverse(k, n))
		s.Mod(s, n)
		if s.Sign() == 0 {
			continue
		}
		if s.Cmp(new(big.Int).Rsh(n, 1)) > 0 {
			s.Sub(n, s)
		}
		return append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	}
}

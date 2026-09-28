package launchpadindex

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	bfttypes "github.com/gnolang/gno/tm2/pkg/bft/types"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/std"
)

type publicationFixture struct {
	creator    crypto.Address
	approver   crypto.Address
	scope      Scope
	txs        map[string][]byte
	blocks     map[int64][]byte
	results    map[int64][]byte
	client     *http.Client
	blockReads map[int64]int
	onBlock    func(int64, int) []byte
}

func nativeTxFixture(t *testing.T, msg std.Msg) ([32]byte, []byte) {
	t.Helper()
	raw, err := amino.Marshal(&std.Tx{Msgs: []std.Msg{msg}})
	if err != nil {
		t.Fatal(err)
	}
	var hash [32]byte
	copy(hash[:], bfttypes.Tx(raw).Hash())
	return hash, raw
}

func encodedReceipt(t *testing.T, hash [32]byte, raw []byte, height int64, index uint32) []byte {
	t.Helper()
	result, err := amino.MarshalJSON(ctypes.ResultTx{
		Hash: hash[:], Height: height, Index: index, Tx: raw,
		TxResult: abci.ResponseDeliverTx{},
	})
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]json.RawMessage{"result": result})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func blockWithNativeTransactions(t *testing.T, height int64, hash, parent byte, txs ...[]byte) []byte {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rpcBlockBodyWithTxCount(t, height, hash, parent, int64(len(txs))), &body); err != nil {
		t.Fatal(err)
	}
	block := body["result"].(map[string]any)["block"].(map[string]any)
	block["data"] = map[string]any{"txs": txs}
	out, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func nativeResults(t *testing.T, height int64, count int) []byte {
	t.Helper()
	delivery, err := amino.MarshalJSON(abci.ResponseDeliverTx{})
	if err != nil {
		t.Fatal(err)
	}
	txs := make([]json.RawMessage, count)
	for i := range txs {
		txs[i] = delivery
	}
	body, err := json.Marshal(map[string]any{"result": map[string]any{
		"height":  strconv.FormatInt(height, 10),
		"results": map[string]any{"deliver_tx": txs},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func newPublicationFixture(t *testing.T, inert bool) *publicationFixture {
	return newPublicationFixtureWithCreator(t, inert, crypto.Address{1})
}

func newPublicationFixtureWithCreator(t *testing.T, inert bool, creator crypto.Address) *publicationFixture {
	t.Helper()
	pkg := &std.MemPackage{Path: TokenRealmPath, Files: []*std.MemFile{
		{Name: "gnomod.toml", Body: "module = \"" + TokenRealmPath + "\"\ngno = \"0.9\"\n"},
		{Name: "tokens.gno", Body: "package tokens\n"},
	}}
	digest, err := vm.PackageContentHash(pkg)
	if err != nil {
		t.Fatal(err)
	}
	digestBytes, err := hex.DecodeString(digest)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &publicationFixture{
		creator:    creator,
		approver:   crypto.Address{2},
		scope:      testScope("test-13", "publication-a"),
		txs:        make(map[string][]byte),
		blocks:     make(map[int64][]byte),
		results:    make(map[int64][]byte),
		blockReads: make(map[int64]int),
	}
	copy(fixture.scope.SourceDigest[:], digestBytes)
	submissionHeight := int64(101)
	if inert {
		submissionHeight = 100
	}
	subHash, subRaw := nativeTxFixture(t, vm.MsgAddPackage{Creator: creator, Package: pkg})
	fixture.scope.SubmissionTxHash = subHash
	fixture.txs[hex.EncodeToString(subHash[:])] = encodedReceipt(t, subHash, subRaw, submissionHeight, 0)
	if inert {
		fixture.blocks[100] = blockWithNativeTransactions(t, 100, 1, 9, subRaw)
		fixture.results[100] = nativeResults(t, 100, 1)
		enableHash, enableRaw := nativeTxFixture(t, vm.MsgEnablePackage{
			Approver: fixture.approver, PkgPath: TokenRealmPath, PkgHash: digest, PkgHeight: 100,
		})
		fixture.scope.ActivationTxHash = enableHash
		fixture.txs[hex.EncodeToString(enableHash[:])] = encodedReceipt(t, enableHash, enableRaw, 101, 0)
		fixture.blocks[101] = blockWithNativeTransactions(t, 101, 2, 1, enableRaw)
		fixture.results[101] = nativeResults(t, 101, 1)
	} else {
		fixture.scope.ActivationMode = "add_package"
		fixture.scope.ActivationTxHash = subHash
		fixture.blocks[101] = blockWithNativeTransactions(t, 101, 2, 1, subRaw)
		fixture.results[101] = nativeResults(t, 101, 1)
	}
	fixture.client = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		var body []byte
		switch request.URL.Path {
		case "/status":
			body = rpcStatusBody("test-13", 102, false)
		case "/tx":
			queryHash := request.URL.Query().Get("hash")
			hash := strings.TrimPrefix(queryHash, "0x")
			if len(queryHash) != 66 || !strings.HasPrefix(queryHash, "0x") ||
				hash != strings.ToLower(hash) {
				http.Error(recorder, "noncanonical hash query", http.StatusBadRequest)
				return recorder.Result(), nil
			}
			if _, err := hex.DecodeString(hash); err != nil {
				http.Error(recorder, "invalid hash query", http.StatusBadRequest)
				return recorder.Result(), nil
			}
			body = fixture.txs[hash]
		case "/block", "/block_results":
			height, _ := strconv.ParseInt(request.URL.Query().Get("height"), 10, 64)
			if request.URL.Path == "/block" {
				fixture.blockReads[height]++
				body = fixture.blocks[height]
				if fixture.onBlock != nil {
					if changed := fixture.onBlock(height, fixture.blockReads[height]); changed != nil {
						body = changed
					}
				}
			} else {
				body = fixture.results[height]
			}
		}
		if body == nil {
			http.NotFound(recorder, request)
		} else {
			_, _ = recorder.Write(body)
		}
		return recorder.Result(), nil
	})}
	return fixture
}

func (f *publicationFixture) verify(t *testing.T) error {
	t.Helper()
	source, err := NewPinnedRPCSource("https://rpc.example", f.client)
	if err != nil {
		t.Fatal(err)
	}
	return (RPCPublicationVerifier{Approval: f.approval()}).VerifyPublication(context.Background(), f.scope, source)
}

func (f *publicationFixture) approval() PublicationApproval {
	approval := PublicationApproval{Scope: f.scope, Creator: f.creator.String(),
		ImmediateExecution: f.scope.ActivationMode == "add_package"}
	if f.scope.ActivationMode == "enable_package" {
		approval.Approver = f.approver.String()
	}
	return approval
}

func TestRPCPublicationVerifierAcceptsExactDirectAndInertPublication(t *testing.T) {
	for _, inert := range []bool{false, true} {
		fixture := newPublicationFixture(t, inert)
		if err := fixture.verify(t); err != nil {
			t.Fatalf("inert=%v: %v", inert, err)
		}
	}
}

func TestRPCPublicationVerifierDrivesOneConfirmedTailerStep(t *testing.T) {
	fixture := newPublicationFixture(t, true)
	ctx := context.Background()
	_, database := testStore(t)
	store, err := OpenStore(ctx, database, fixture.scope)
	if err != nil {
		t.Fatal(err)
	}
	source, err := NewPinnedRPCSource("https://rpc.example", fixture.client)
	if err != nil {
		t.Fatal(err)
	}
	verifier := RPCPublicationVerifier{Approval: fixture.approval()}
	tailer, err := NewTailer(store, source, verifier, 1)
	if err != nil {
		t.Fatal(err)
	}
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("verified activation block was not journaled: progressed=%v err=%v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 101 || cursor.Hash != fixture.scope.PublicationHash {
		t.Fatalf("wrong verified cursor: %+v %v", cursor, err)
	}
}

func TestRPCPublicationVerifierRejectsMismatchedEvidence(t *testing.T) {
	t.Run("wrong source digest", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		fixture.scope.SourceDigest[0]++
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("source digest mismatch: %v", err)
		}
	})
	t.Run("unapproved source", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		source, err := NewPinnedRPCSource("https://rpc.example", fixture.client)
		if err != nil {
			t.Fatal(err)
		}
		approval := fixture.approval()
		approval.Scope.SourceDigest[0]++
		if err := (RPCPublicationVerifier{Approval: approval}).VerifyPublication(context.Background(), fixture.scope, source); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("unapproved source accepted: %v", err)
		}
	})
	t.Run("same source from unapproved creator", func(t *testing.T) {
		fixture := newPublicationFixtureWithCreator(t, true, crypto.Address{3})
		source, err := NewPinnedRPCSource("https://rpc.example", fixture.client)
		if err != nil {
			t.Fatal(err)
		}
		approval := fixture.approval()
		approval.Creator = (crypto.Address{1}).String()
		if err := (RPCPublicationVerifier{Approval: approval}).VerifyPublication(context.Background(), fixture.scope, source); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("different creator with identical source accepted: %v", err)
		}
		original := newPublicationFixture(t, true)
		if err := (RPCPublicationVerifier{Approval: original.approval()}).VerifyPublication(context.Background(), fixture.scope, source); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("different transaction hashes accepted under original release approval: %v", err)
		}
	})
	t.Run("direct add on inert mainnet", func(t *testing.T) {
		fixture := newPublicationFixture(t, false)
		fixture.scope.ChainID = "gnoland-1"
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("mainnet AddPackage treated as activation: %v", err)
		}
	})
	t.Run("different activation block", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		fixture.scope.PublicationHash[0]++
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("activation block mismatch: %v", err)
		}
	})
	t.Run("different raw transaction at receipt position", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		fixture.blocks[100] = blockWithNativeTransactions(t, 100, 1, 9, []byte("different"))
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("raw transaction mismatch: %v", err)
		}
	})
	t.Run("different delivery result", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		fixture.results[101] = bytes.Replace(fixture.results[101], []byte(`"Error":null`),
			[]byte(`"Error":{"@type":"/std.InvalidPkgPathError"}`), 1)
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("delivery mismatch: %v", err)
		}
	})
	t.Run("duplicate submission in same block", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		var submission ctypes.ResultTx
		var envelope struct {
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(fixture.txs[hex.EncodeToString(fixture.scope.SubmissionTxHash[:])], &envelope); err != nil {
			t.Fatal(err)
		}
		if err := amino.UnmarshalJSON(envelope.Result, &submission); err != nil {
			t.Fatal(err)
		}
		fixture.blocks[100] = blockWithNativeTransactions(t, 100, 1, 9, submission.Tx, submission.Tx)
		fixture.results[100] = nativeResults(t, 100, 2)
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("same-height re-park accepted: %v", err)
		}
	})
	t.Run("submission fork changes during verification", func(t *testing.T) {
		fixture := newPublicationFixture(t, true)
		fixture.onBlock = func(height int64, count int) []byte {
			if height == 100 && count > 1 {
				return blockWithNativeTransactions(t, 100, 7, 9, []byte("fork"))
			}
			return nil
		}
		if err := fixture.verify(t); !errors.Is(err, ErrPublicationProof) {
			t.Fatalf("mixed-fork publication accepted: %v", err)
		}
	})
}

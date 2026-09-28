package launchpadindex

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	bfttypes "github.com/gnolang/gno/tm2/pkg/bft/types"
	_ "github.com/gnolang/gno/tm2/pkg/sdk/auth"
	_ "github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/std"
)

var ErrPublicationProof = errors.New("invalid Launchpad publication evidence")

// PublicationApproval pins the entire publication scope and both actors. It
// must come from a separately reviewed immutable release manifest, never from
// RPC or a scope copied at runtime. ImmediateExecution is a historical chain
// policy attestation; a successful AddPackage can otherwise be inert.
type PublicationApproval struct {
	Scope              Scope
	Creator            string
	Approver           string
	ImmediateExecution bool
}

// RPCPublicationVerifier binds an approved source to native transaction bytes,
// successful deliveries and their block positions at one pinned RPC source.
// The endpoint's reported block IDs remain claims, not consensus proofs.
type RPCPublicationVerifier struct{ Approval PublicationApproval }

type nativeReceipt struct {
	result ctypes.ResultTx
	tx     std.Tx
	header BlockHeader
	block  [][]byte
}

func (v RPCPublicationVerifier) VerifyPublication(ctx context.Context, scope Scope, source *PinnedRPCSource) error {
	if !validScope(scope) || source == nil {
		return ErrPublicationProof
	}
	if v.Approval.Scope != scope || v.Approval.Creator == "" ||
		(scope.ActivationMode == "add_package" &&
			(!v.Approval.ImmediateExecution || scope.ChainID == "gnoland-1" || v.Approval.Approver != "")) ||
		(scope.ActivationMode == "enable_package" &&
			(v.Approval.ImmediateExecution || v.Approval.Approver == "")) {
		return ErrPublicationProof
	}
	submission, err := readNativeReceipt(ctx, source, scope, scope.SubmissionTxHash)
	if err != nil {
		return fmt.Errorf("verify Launchpad submission: %w", err)
	}
	if len(submission.tx.Msgs) != 1 {
		return ErrPublicationProof
	}
	add, ok := submission.tx.Msgs[0].(vm.MsgAddPackage)
	if !ok || add.Creator.IsZero() || add.Package == nil || add.Package.Path != scope.RealmPath ||
		add.Creator.String() != v.Approval.Creator {
		return ErrPublicationProof
	}
	if err := uniqueSubmissionInBlock(submission.block, scope.RealmPath); err != nil {
		return err
	}
	sourceHash, err := vm.PackageContentHash(add.Package)
	if err != nil || sourceHash != hex.EncodeToString(scope.SourceDigest[:]) {
		return ErrPublicationProof
	}
	if scope.ActivationMode == "add_package" {
		if submission.result.Height != scope.PublicationHeight ||
			int(submission.result.Index) != scope.ActivationTxIndex ||
			submission.header.Hash != scope.PublicationHash ||
			submission.header.ParentHash != scope.PublicationParentHash {
			return ErrPublicationProof
		}
		return verifyActivationAnchor(ctx, source, scope, submission.header)
	}
	activation, err := readNativeReceipt(ctx, source, scope, scope.ActivationTxHash)
	if err != nil {
		return fmt.Errorf("verify Launchpad activation: %w", err)
	}
	if len(activation.tx.Msgs) != 1 {
		return ErrPublicationProof
	}
	enable, ok := activation.tx.Msgs[0].(vm.MsgEnablePackage)
	if !ok || enable.Approver.IsZero() || enable.PkgPath != scope.RealmPath ||
		enable.Approver.String() != v.Approval.Approver ||
		enable.PkgHash != sourceHash || enable.PkgHeight != submission.result.Height ||
		activation.result.Height != scope.PublicationHeight ||
		int(activation.result.Index) != scope.ActivationTxIndex ||
		activation.header.Hash != scope.PublicationHash ||
		activation.header.ParentHash != scope.PublicationParentHash ||
		(submission.result.Height > activation.result.Height ||
			(submission.result.Height == activation.result.Height && submission.result.Index >= activation.result.Index)) {
		return ErrPublicationProof
	}
	if submission.result.Height == activation.result.Height && submission.header != activation.header {
		return ErrPublicationProof
	}
	if submission.result.Height+1 == activation.result.Height &&
		activation.header.ParentHash != submission.header.Hash {
		return ErrPublicationProof
	}
	if err := verifyObservedHeader(ctx, source, scope.ChainID, submission.header); err != nil {
		return err
	}
	return verifyActivationAnchor(ctx, source, scope, activation.header)
}

func verifyObservedHeader(ctx context.Context, source *PinnedRPCSource, chainID string, expected BlockHeader) error {
	body, err := source.block(ctx, expected.Height)
	if err != nil {
		return err
	}
	header, err := ParseBlockHeader(body, chainID, expected.Height)
	if err != nil || header != expected {
		return ErrPublicationProof
	}
	return nil
}

func verifyActivationAnchor(ctx context.Context, source *PinnedRPCSource, scope Scope, expected BlockHeader) error {
	if expected.Hash != scope.PublicationHash || expected.ParentHash != scope.PublicationParentHash {
		return ErrPublicationProof
	}
	return verifyObservedHeader(ctx, source, scope.ChainID, expected)
}

// PkgHeight alone cannot distinguish two submissions to the same realm in one
// block. Unknown transaction types fail closed rather than hiding a re-park.
func uniqueSubmissionInBlock(rawTxs [][]byte, realmPath string) error {
	count := 0
	for _, raw := range rawTxs {
		var tx std.Tx
		if err := amino.Unmarshal(raw, &tx); err != nil {
			return ErrPublicationProof
		}
		for _, message := range tx.Msgs {
			if add, ok := message.(vm.MsgAddPackage); ok &&
				add.Package != nil && add.Package.Path == realmPath {
				count++
			}
		}
	}
	if count != 1 {
		return ErrPublicationProof
	}
	return nil
}

func readNativeReceipt(ctx context.Context, source *PinnedRPCSource, scope Scope, wantedHash [32]byte) (nativeReceipt, error) {
	var evidence nativeReceipt
	body, err := source.transaction(ctx, wantedHash)
	if err != nil {
		return evidence, err
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || len(envelope.Result) == 0 ||
		bytes.Equal(bytes.TrimSpace(envelope.Result), []byte("null")) ||
		(len(envelope.Error) > 0 && !bytes.Equal(bytes.TrimSpace(envelope.Error), []byte("null"))) {
		return evidence, ErrPublicationProof
	}
	if err := amino.UnmarshalJSON(envelope.Result, &evidence.result); err != nil ||
		!bytes.Equal(evidence.result.Hash, wantedHash[:]) ||
		!bytes.Equal(bfttypes.Tx(evidence.result.Tx).Hash(), wantedHash[:]) ||
		evidence.result.Height <= 0 || evidence.result.TxResult.IsErr() {
		return evidence, ErrPublicationProof
	}
	if err := amino.Unmarshal(evidence.result.Tx, &evidence.tx); err != nil {
		return evidence, ErrPublicationProof
	}
	blockBody, err := source.block(ctx, evidence.result.Height)
	if err != nil {
		return evidence, err
	}
	evidence.header, err = ParseBlockHeader(blockBody, scope.ChainID, evidence.result.Height)
	if err != nil {
		return evidence, err
	}
	var block struct {
		Result *struct {
			Block *struct {
				Data *struct {
					Txs [][]byte `json:"txs"`
				} `json:"data"`
			} `json:"block"`
		} `json:"result"`
	}
	if err := json.Unmarshal(blockBody, &block); err != nil || block.Result == nil ||
		block.Result.Block == nil || block.Result.Block.Data == nil ||
		int64(len(block.Result.Block.Data.Txs)) != evidence.header.NumTxs ||
		int64(evidence.result.Index) >= evidence.header.NumTxs ||
		!bytes.Equal(block.Result.Block.Data.Txs[evidence.result.Index], evidence.result.Tx) {
		return evidence, ErrPublicationProof
	}
	evidence.block = block.Result.Block.Data.Txs
	resultsBody, err := source.results(ctx, evidence.result.Height)
	if err != nil {
		return evidence, err
	}
	var results struct {
		Result *struct {
			Height  string `json:"height"`
			Results *struct {
				DeliverTx []json.RawMessage `json:"deliver_tx"`
			} `json:"results"`
		} `json:"result"`
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(resultsBody, &results); err != nil || results.Result == nil ||
		results.Result.Results == nil ||
		results.Result.Height != fmt.Sprint(evidence.result.Height) ||
		int64(len(results.Result.Results.DeliverTx)) != evidence.header.NumTxs ||
		(len(results.Error) > 0 && !bytes.Equal(bytes.TrimSpace(results.Error), []byte("null"))) {
		return evidence, ErrPublicationProof
	}
	var delivery abci.ResponseDeliverTx
	if err := amino.UnmarshalJSON(results.Result.Results.DeliverTx[evidence.result.Index], &delivery); err != nil ||
		delivery.IsErr() || !reflect.DeepEqual(delivery, evidence.result.TxResult) {
		return evidence, ErrPublicationProof
	}
	return evidence, nil
}

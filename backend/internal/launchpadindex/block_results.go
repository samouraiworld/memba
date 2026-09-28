package launchpadindex

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
)

// ObservedCreation is an event position in one RPC response. The position is
// not a durable launch record until a chain-bound tailer verifies the block
// hash, confirmations, realm generation and block-header time.
type ObservedCreation struct {
	TokenCreated
	BlockHeight int64
	TxIndex     int
	EventIndex  int
}

type blockResultsResponse struct {
	Result *struct {
		Height  string `json:"height"`
		Results *struct {
			DeliverTx json.RawMessage `json:"deliver_tx"`
		} `json:"results"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type deliveredTx struct {
	ResponseBase struct {
		Error  json.RawMessage `json:"Error"`
		Events json.RawMessage `json:"Events"`
	} `json:"ResponseBase"`
}

type rawEvent struct {
	Type    string      `json:"type"`
	PkgPath string      `json:"pkg_path"`
	Attrs   []Attribute `json:"attrs"`
}

// ParseBlockResults extracts only successful tokens/v1 creation events from a
// raw /block_results response. A malformed creation event fails the entire
// block so a future cursor cannot silently advance past missing identities.
// The caller must independently verify RPC chain ID, block hash and finality.
func ParseBlockResults(body []byte, expectedHeight int64) ([]ObservedCreation, error) {
	var response blockResultsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode Launchpad block results: %w", err)
	}
	if response.Error != nil {
		return nil, fmt.Errorf("launchpad block results RPC error: %s", response.Error.Message)
	}
	if response.Result == nil || response.Result.Results == nil ||
		len(response.Result.Results.DeliverTx) == 0 {
		return nil, fmt.Errorf("launchpad block results are incomplete")
	}
	height, err := strconv.ParseInt(response.Result.Height, 10, 64)
	if err != nil || height <= 0 || height != expectedHeight ||
		response.Result.Height != strconv.FormatInt(height, 10) {
		return nil, fmt.Errorf("launchpad block results height mismatch")
	}
	var txs []deliveredTx
	if err := json.Unmarshal(response.Result.Results.DeliverTx, &txs); err != nil {
		return nil, fmt.Errorf("decode Launchpad delivered transactions: %w", err)
	}
	var out []ObservedCreation
	for txIndex, tx := range txs {
		if len(tx.ResponseBase.Error) == 0 {
			return nil, fmt.Errorf("launchpad tx %d has no success status", txIndex)
		}
		if !bytes.Equal(bytes.TrimSpace(tx.ResponseBase.Error), []byte("null")) {
			continue // unsuccessful delivery cannot create a token
		}
		if len(tx.ResponseBase.Events) == 0 {
			return nil, fmt.Errorf("launchpad tx %d has no events field", txIndex)
		}
		var events []rawEvent
		if err := json.Unmarshal(tx.ResponseBase.Events, &events); err != nil {
			return nil, fmt.Errorf("decode Launchpad tx %d events: %w", txIndex, err)
		}
		for eventIndex, event := range events {
			if event.PkgPath != TokenRealmPath {
				continue
			}
			if event.Type == "" {
				return nil, fmt.Errorf("launchpad tx %d event %d has no type", txIndex, eventIndex)
			}
			if event.Type != TokenCreatedType {
				continue
			}
			created, err := ParseTokenCreated(event.PkgPath, event.Type, event.Attrs)
			if err != nil {
				return nil, fmt.Errorf("launchpad tx %d event %d: %w", txIndex, eventIndex, err)
			}
			out = append(out, ObservedCreation{
				TokenCreated: created, BlockHeight: height,
				TxIndex: txIndex, EventIndex: eventIndex,
			})
		}
	}
	return out, nil
}

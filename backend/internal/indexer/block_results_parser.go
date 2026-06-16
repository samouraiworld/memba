package indexer

import (
	"encoding/json"
	"fmt"
)

// GnoEvent is a single normalized chain.Emit event extracted from a block's
// /block_results response, tagged with its position so writes are idempotent.
type GnoEvent struct {
	Type     string            // logical event type, e.g. "NFTListed" (the chain.Emit first arg)
	PkgPath  string            // emitting realm, e.g. "gno.land/r/samcrew/memba_nft_market_v2"
	Attrs    map[string]string // flattened attribute key→value
	Block    int64             // block height
	TxIndex  int               // index of the tx within the block
	EventIdx int               // index of the event within the tx's ResponseBase.Events
}

// Attr returns the value for key, or "" when absent.
func (e GnoEvent) Attr(key string) string { return e.Attrs[key] }

// ── /block_results JSON shape (verified against the live test13 node) ─────────
//
// POST/GET <rpc>/block_results?height=N returns:
//
//	{ "result": { "height": "N", "results": {
//	    "deliver_tx": [ { "ResponseBase": { "Events": [
//	        { "type": "GnoEvent",
//	          "attrs": [ {"key":"...","value":"..."} ],
//	          "pkg_path": "gno.land/r/..." } ] } } ],
//	    "begin_block": {...}, "end_block": {...} } } }
//
// deliver_tx is null (not []) for empty blocks. The chain.Emit logical type is
// the abci event's "type" field ("NFTListed", etc.) — note it is NOT literally
// the string "GnoEvent" in the live node; that confirmation is below. We accept
// both the documented "GnoEvent" envelope and the direct logical-type form, and
// filter by pkg_path against the watched-realms set in the caller.

type blockResultsResponse struct {
	Result struct {
		Height  string `json:"height"`
		Results struct {
			DeliverTx []struct {
				ResponseBase struct {
					Events []rawEvent `json:"Events"`
				} `json:"ResponseBase"`
			} `json:"deliver_tx"`
		} `json:"results"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// rawEvent matches the gno abci.Event JSON encoding: GnoEventAttribute uses the
// JSON tags "key"/"value" and the event uses "type"/"attrs"/"pkg_path".
type rawEvent struct {
	Type    string `json:"type"`
	PkgPath string `json:"pkg_path"`
	Func    string `json:"func"`
	Attrs   []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"attrs"`
}

// parseBlockResults decodes a /block_results JSON body into normalized
// GnoEvents at the given height. Events are returned in (tx_index, event_index)
// order. Only events with a non-empty PkgPath are kept (begin/end-block and
// non-gno events carry none). Returns an error only for malformed JSON or an
// RPC-level error; an empty block yields (nil, nil).
func parseBlockResults(body []byte, height int64) ([]GnoEvent, error) {
	var r blockResultsResponse
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("decode block_results: %w", err)
	}
	if r.Error != nil {
		return nil, fmt.Errorf("rpc error: %s", r.Error.Message)
	}

	var out []GnoEvent
	for txIdx, tx := range r.Result.Results.DeliverTx {
		for evIdx, ev := range tx.ResponseBase.Events {
			if ev.PkgPath == "" {
				continue
			}
			attrs := make(map[string]string, len(ev.Attrs))
			for _, a := range ev.Attrs {
				attrs[a.Key] = a.Value
			}
			out = append(out, GnoEvent{
				Type:     ev.Type,
				PkgPath:  ev.PkgPath,
				Attrs:    attrs,
				Block:    height,
				TxIndex:  txIdx,
				EventIdx: evIdx,
			})
		}
	}
	return out, nil
}

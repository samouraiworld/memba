package activitywatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

type block struct {
	BlockMeta struct {
		BlockID struct {
			Hash string `json:"hash"`
		} `json:"block_id"`
	} `json:"block_meta"`
	Block struct {
		Header struct {
			ChainID     string    `json:"chain_id"`
			Height      string    `json:"height"`
			NumTxs      string    `json:"num_txs"`
			Time        time.Time `json:"time"`
			LastBlockID struct {
				Hash string `json:"hash"`
			} `json:"last_block_id"`
		} `json:"header"`
		Data struct {
			Txs [][]byte `json:"txs"`
		} `json:"data"`
	} `json:"block"`
}

type event struct {
	Kind    string `json:"@type"`
	Type    string `json:"type"`
	PkgPath string `json:"pkg_path"`
}

type receipt struct {
	ResponseBase *struct {
		Error  json.RawMessage `json:"Error"`
		Events []event         `json:"Events"`
	} `json:"ResponseBase"`
}

type results struct {
	Height  string `json:"height"`
	Results *struct {
		DeliverTx []receipt `json:"deliver_tx"`
	} `json:"results"`
}

func (w *Watcher) rpc(ctx context.Context, method string, params any, out any) error {
	b, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.cfg.RPCURL, bytes.NewReader(b))
	if err != nil {
		return errors.New("invalid RPC request")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.client.Do(req)
	if err != nil {
		return errors.New("activity RPC transport failed")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("activity RPC HTTP %d", resp.StatusCode)
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&env); err != nil {
		return errors.New("invalid RPC JSON")
	}
	if !null(env.Error) || null(env.Result) {
		return errors.New("activity RPC returned an error or no result")
	}
	if err := json.Unmarshal(env.Result, out); err != nil {
		return errors.New("invalid RPC result")
	}
	return nil
}

func null(b json.RawMessage) bool { return len(b) == 0 || string(b) == "null" }

func (w *Watcher) head(ctx context.Context) (int64, error) {
	var r struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			Height     string    `json:"latest_block_height"`
			Time       time.Time `json:"latest_block_time"`
			CatchingUp bool      `json:"catching_up"`
		} `json:"sync_info"`
	}
	if err := w.rpc(ctx, "status", map[string]any{}, &r); err != nil {
		return 0, err
	}
	h, err := strconv.ParseInt(r.SyncInfo.Height, 10, 64)
	age := w.now().Sub(r.SyncInfo.Time)
	if err != nil || h <= confirmations || r.NodeInfo.Network != w.cfg.ChainID || r.SyncInfo.CatchingUp || age > 2*time.Minute || age < -time.Minute {
		return 0, errors.New("activity RPC chain, height or freshness check failed")
	}
	return h, nil
}

func (w *Watcher) block(ctx context.Context, height int64) (block, error) {
	var b block
	err := w.rpc(ctx, "block", map[string]string{"height": strconv.FormatInt(height, 10)}, &b)
	if err != nil {
		return b, err
	}
	if b.Block.Header.ChainID != w.cfg.ChainID || b.Block.Header.Height != strconv.FormatInt(height, 10) || b.BlockMeta.BlockID.Hash == "" || b.Block.Header.Time.IsZero() {
		return b, errors.New("activity block identity mismatch")
	}
	n, err := strconv.Atoi(b.Block.Header.NumTxs)
	if err != nil || n != len(b.Block.Data.Txs) {
		return b, errors.New("activity block transaction count mismatch")
	}
	return b, nil
}

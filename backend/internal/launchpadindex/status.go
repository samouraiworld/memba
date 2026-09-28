package launchpadindex

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

var ErrInvalidNodeStatus = errors.New("invalid Launchpad node status")

// ReadyStatus is a /status observation from a node serving the expected chain
// and reporting that it has caught up. A future tailer must recheck it after
// reconnect and still apply a confirmation depth before using a block.
type ReadyStatus struct {
	ChainID      string
	LatestHeight int64
}

type rpcStatusResponse struct {
	Result *struct {
		NodeInfo *struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo *struct {
			LatestBlockHeight string `json:"latest_block_height"`
			CatchingUp        *bool  `json:"catching_up"`
		} `json:"sync_info"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ParseReadyStatus validates one raw /status response. It fails closed when
// the node's network identity or synchronization state is missing or wrong.
func ParseReadyStatus(body []byte, expectedChainID string) (ReadyStatus, error) {
	if expectedChainID == "" {
		return ReadyStatus{}, ErrInvalidNodeStatus
	}
	var response rpcStatusResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return ReadyStatus{}, fmt.Errorf("decode Launchpad node status: %w", err)
	}
	if response.Error != nil {
		return ReadyStatus{}, fmt.Errorf("launchpad node status RPC error: %s", response.Error.Message)
	}
	if response.Result == nil || response.Result.NodeInfo == nil ||
		response.Result.SyncInfo == nil || response.Result.NodeInfo.Network != expectedChainID ||
		response.Result.SyncInfo.CatchingUp == nil || *response.Result.SyncInfo.CatchingUp {
		return ReadyStatus{}, ErrInvalidNodeStatus
	}
	heightText := response.Result.SyncInfo.LatestBlockHeight
	height, err := strconv.ParseInt(heightText, 10, 64)
	if err != nil || height <= 0 || heightText != strconv.FormatInt(height, 10) {
		return ReadyStatus{}, ErrInvalidNodeStatus
	}
	return ReadyStatus{ChainID: expectedChainID, LatestHeight: height}, nil
}

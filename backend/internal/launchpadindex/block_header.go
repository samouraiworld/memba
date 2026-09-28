package launchpadindex

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"
)

var ErrInvalidBlockHeader = errors.New("invalid Launchpad block header")

// BlockHeader is a self-consistent /block RPC observation. Hash is the
// RPC-reported block ID, not independently verified consensus evidence.
// A tailer must still verify its endpoint, confirmation depth and reorgs.
type BlockHeader struct {
	ChainID string
	Height  int64
	Hash    [32]byte
	Time    time.Time
}

type rpcHeader struct {
	ChainID string `json:"chain_id"`
	Height  string `json:"height"`
	Time    string `json:"time"`
}

type rpcBlockResponse struct {
	Result *struct {
		BlockMeta *struct {
			BlockID *struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
			Header *rpcHeader `json:"header"`
		} `json:"block_meta"`
		Block *struct {
			Header *rpcHeader `json:"header"`
		} `json:"block"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ParseBlockHeader requires the block metadata and full block headers to agree
// with the caller's expected chain and height. It never substitutes wall-clock
// ingest time for the chain header timestamp.
func ParseBlockHeader(body []byte, expectedChainID string, expectedHeight int64) (BlockHeader, error) {
	if expectedChainID == "" || expectedHeight <= 0 {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	var response rpcBlockResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return BlockHeader{}, fmt.Errorf("decode Launchpad block: %w", err)
	}
	if response.Error != nil {
		return BlockHeader{}, fmt.Errorf("launchpad block RPC error: %s", response.Error.Message)
	}
	if response.Result == nil || response.Result.BlockMeta == nil ||
		response.Result.BlockMeta.BlockID == nil || response.Result.BlockMeta.Header == nil ||
		response.Result.Block == nil || response.Result.Block.Header == nil {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	meta := response.Result.BlockMeta.Header
	block := response.Result.Block.Header
	if meta.ChainID != expectedChainID || block.ChainID != expectedChainID ||
		!matchesHeight(meta.Height, expectedHeight) || !matchesHeight(block.Height, expectedHeight) {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	metaTime, err := time.Parse(time.RFC3339Nano, meta.Time)
	if err != nil {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	blockTime, err := time.Parse(time.RFC3339Nano, block.Time)
	if err != nil || !metaTime.Equal(blockTime) || metaTime.Unix() <= 0 {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	hashText := response.Result.BlockMeta.BlockID.Hash
	hashBytes, err := base64.StdEncoding.DecodeString(hashText)
	if err != nil || len(hashBytes) != 32 || base64.StdEncoding.EncodeToString(hashBytes) != hashText {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	var hash [32]byte
	copy(hash[:], hashBytes)
	return BlockHeader{
		ChainID: expectedChainID, Height: expectedHeight,
		Hash: hash, Time: metaTime.UTC(),
	}, nil
}

func matchesHeight(value string, expected int64) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed == expected && value == strconv.FormatInt(expected, 10)
}

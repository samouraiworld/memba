package launchpadindex

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"time"
)

var ErrInvalidBlockHeader = errors.New("invalid Launchpad block header")

// BlockHeader is a self-consistent /block RPC observation. Hash is the
// RPC-reported block ID, not independently verified consensus evidence.
// A tailer must still verify its endpoint, confirmation depth and reorgs.
type BlockHeader struct {
	ChainID    string
	Height     int64
	Hash       [32]byte
	ParentHash [32]byte
	Time       time.Time
}

type rpcHeader struct {
	ChainID     string `json:"chain_id"`
	Height      string `json:"height"`
	Time        string `json:"time"`
	LastBlockID *struct {
		Hash string `json:"hash"`
	} `json:"last_block_id"`
}

type rpcBlockResponse struct {
	Result *struct {
		BlockMeta *struct {
			BlockID *struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
			Header json.RawMessage `json:"header"`
		} `json:"block_meta"`
		Block *struct {
			Header json.RawMessage `json:"header"`
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
		response.Result.BlockMeta.BlockID == nil || len(response.Result.BlockMeta.Header) == 0 ||
		response.Result.Block == nil || len(response.Result.Block.Header) == 0 {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	meta, metaFields, err := decodeRPCHeader(response.Result.BlockMeta.Header)
	if err != nil {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	block, blockFields, err := decodeRPCHeader(response.Result.Block.Header)
	if err != nil || !reflect.DeepEqual(metaFields, blockFields) {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
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
	hash, ok := canonicalHash(response.Result.BlockMeta.BlockID.Hash)
	if !ok || meta.LastBlockID == nil {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	parentHash, ok := canonicalHash(meta.LastBlockID.Hash)
	if !ok {
		return BlockHeader{}, ErrInvalidBlockHeader
	}
	return BlockHeader{
		ChainID: expectedChainID, Height: expectedHeight,
		Hash: hash, ParentHash: parentHash, Time: metaTime.UTC(),
	}, nil
}

func canonicalHash(value string) ([32]byte, bool) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) != 32 || base64.StdEncoding.EncodeToString(decoded) != value {
		return [32]byte{}, false
	}
	var hash [32]byte
	copy(hash[:], decoded)
	return hash, true
}

// Keep unknown header fields in the equality check: a future chain upgrade
// must not let a block ID from metadata be paired with a different full header.
func decodeRPCHeader(raw json.RawMessage) (rpcHeader, any, error) {
	var header rpcHeader
	if err := json.Unmarshal(raw, &header); err != nil {
		return rpcHeader{}, nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var fields any
	if err := decoder.Decode(&fields); err != nil {
		return rpcHeader{}, nil, err
	}
	if _, ok := fields.(map[string]any); !ok {
		return rpcHeader{}, nil, ErrInvalidBlockHeader
	}
	return header, fields, nil
}

func matchesHeight(value string, expected int64) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed == expected && value == strconv.FormatInt(expected, 10)
}

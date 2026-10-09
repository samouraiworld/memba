package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/samouraiworld/memba/backend/internal/address"
	"github.com/samouraiworld/memba/backend/internal/arcade"
)

const (
	arcadeFreePlayConfigPathEnv = "MEMBA_ARCADE_FREEPLAY_CONFIG_PATH"
	arcadeFreePlayPasswordEnv   = "MEMBA_ARCADE_FREEPLAY_KEYRING_PW"
	arcadeFreePlayConfigMaxSize = 64 << 10
	arcadeFreePlayPasswordMax   = 1024 // Bytes; empty values and CR/LF/NUL are refused.
)

var (
	errArcadeFreePlayConfig = errors.New("invalid_freeplay_configuration")
	errArcadeFreePlaySecret = errors.New("freeplay_secret_unavailable")
	// Integer unit segments only: no signs, floats, whitespace or sub-ns rounding.
	arcadeFreePlayDurationText = regexp.MustCompile(`^(?:[0-9]+(?:ns|us|ms|s|m|h))+$`)
)

// All fields are required except the two publication-only path references.
// This wire type deliberately does not expose Go's numeric time.Duration format.
type arcadeFreePlayConfigDocument struct {
	Cost struct {
		Target struct {
			ChainID string `json:"chainId"`
			Realm   string `json:"realm"`
		} `json:"target"`
		GasWanted            int64  `json:"gasWanted"`
		StorageBytes         int64  `json:"storageBytes"`
		FeeMarginNumerator   int64  `json:"feeMarginNumerator"`
		FeeMarginDenominator int64  `json:"feeMarginDenominator"`
		MaxFeeUgnot          int64  `json:"maxFeeUgnot"`
		MaxDepositUgnot      int64  `json:"maxDepositUgnot"`
		MaxPriceAge          string `json:"maxPriceAge"`
		QuoteLifetime        string `json:"quoteLifetime"`
	} `json:"cost"`
	Budget struct {
		Signer          string `json:"signer"`
		MaxAttempts     int64  `json:"maxAttempts"`
		MaxFeeUgnot     int64  `json:"maxFeeUgnot"`
		MaxDepositUgnot int64  `json:"maxDepositUgnot"`
	} `json:"budget"`
	RPCURL          string `json:"rpcUrl"`
	RPCBlockAge     string `json:"rpcBlockAge"`
	RPCTimeout      string `json:"rpcTimeout"`
	PublishInterval string `json:"publishInterval"`
	Publish         bool   `json:"publish"`
	Limits          struct {
		IPRequests     int    `json:"ipRequests"`
		WalletRequests int    `json:"walletRequests"`
		MaxEntries     int    `json:"maxEntries"`
		Window         string `json:"window"`
	} `json:"limits"`
	Node struct {
		NodeBin        string `json:"nodeBin"`
		Timeout        string `json:"timeout"`
		Concurrency    int    `json:"concurrency"`
		MaxOutputBytes int64  `json:"maxOutputBytes"`
	} `json:"node"`
	GnokeyBinary *string `json:"gnokeyBinary,omitempty"`
	KeyringHome  *string `json:"keyringHome,omitempty"`
}

type arcadeFreePlayConfigIO struct {
	Open             func(string) (io.ReadCloser, error)
	LookupEnv        func(string) (string, bool)
	BroadcastFactory func(string, string, func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error)
}

// The absent path returns before even assigning I/O defaults. No secret lookup,
// filesystem, DB, Node, RPC, ticker or signing dependency is needed in this case.
func loadArcadeFreePlayConfig(path, serverChain string, deps arcadeFreePlayConfigIO) (*arcadeFreePlayConfig, arcade.FreePlayBroadcastFunc, error) {
	if path == "" {
		return nil, nil, nil
	}
	if !validArcadeFreePlayPath(path) {
		return nil, nil, errArcadeFreePlayConfig
	}
	open := deps.Open
	if open == nil {
		open = openArcadeFreePlayConfig
	}
	reader, err := open(path)
	if err != nil || reader == nil {
		if reader != nil {
			_ = reader.Close()
		}
		return nil, nil, errArcadeFreePlayConfig
	}
	raw, readErr := io.ReadAll(io.LimitReader(reader, arcadeFreePlayConfigMaxSize+1))
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || len(raw) > arcadeFreePlayConfigMaxSize || !utf8.Valid(raw) {
		return nil, nil, errArcadeFreePlayConfig
	}
	var doc arcadeFreePlayConfigDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if strictArcadeFreePlayValue(decoder, reflect.TypeOf(doc)) != nil {
		return nil, nil, errArcadeFreePlayConfig
	}
	if _, err = decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, nil, errArcadeFreePlayConfig
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil, nil, errArcadeFreePlayConfig
	}
	cfg, err := doc.configuration(serverChain)
	if err != nil {
		return nil, nil, errArcadeFreePlayConfig
	}
	if !cfg.Publish {
		// Even empty references are refused rather than silently retained.
		if doc.GnokeyBinary != nil || doc.KeyringHome != nil {
			return nil, nil, errArcadeFreePlayConfig
		}
		return cfg, nil, nil
	}
	if doc.GnokeyBinary == nil || doc.KeyringHome == nil || !validArcadeFreePlayPath(*doc.GnokeyBinary) || !validArcadeFreePlayPath(*doc.KeyringHome) {
		return nil, nil, errArcadeFreePlayConfig
	}
	lookup := deps.LookupEnv
	if lookup == nil {
		lookup = os.LookupEnv
	}
	password := func(ctx context.Context) (string, error) {
		if ctx == nil || ctx.Err() != nil {
			return "", errArcadeFreePlaySecret
		}
		// Only the dedicated secret name is read, only during an authorized send.
		value, present := lookup(arcadeFreePlayPasswordEnv)
		if ctx.Err() != nil || !present || len(value) == 0 || len(value) > arcadeFreePlayPasswordMax || strings.ContainsAny(value, "\r\n\x00") {
			return "", errArcadeFreePlaySecret
		}
		return value, nil
	}
	factory := deps.BroadcastFactory
	if factory == nil {
		factory = arcade.NewFreePlayGnokeyBroadcast
	}
	broadcast, err := factory(*doc.GnokeyBinary, *doc.KeyringHome, password)
	if err != nil || broadcast == nil {
		return nil, nil, errArcadeFreePlayConfig
	}
	return cfg, broadcast, nil
}

func validArcadeFreePlayPath(path string) bool {
	return filepath.IsAbs(path) && len(path) <= 4096 && !strings.ContainsAny(path, "\x00\r\n")
}

func openArcadeFreePlayConfig(path string) (io.ReadCloser, error) {
	// Reject special files before opening; this is an operator-controlled mount,
	// not a request-supplied path. Check again on the opened descriptor.
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > arcadeFreePlayConfigMaxSize {
		return nil, errArcadeFreePlayConfig
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errArcadeFreePlayConfig
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > arcadeFreePlayConfigMaxSize {
		_ = file.Close()
		return nil, errArcadeFreePlayConfig
	}
	return file, nil
}

// Validate the exact schema before decoding values. encoding/json alone accepts
// duplicate keys, case aliases and null scalars; none is operator intent here.
// Recursion follows the fixed document type, so nested untrusted objects cannot
// increase depth beyond the schema. json.Number avoids float conversions.
func strictArcadeFreePlayValue(decoder *json.Decoder, schema reflect.Type) error {
	if schema.Kind() == reflect.Pointer {
		schema = schema.Elem()
	}
	token, err := decoder.Token()
	if err != nil {
		return errArcadeFreePlayConfig
	}
	switch schema.Kind() {
	case reflect.Struct:
		if token != json.Delim('{') {
			return errArcadeFreePlayConfig
		}
		fields := make(map[string]reflect.StructField, schema.NumField())
		for i := 0; i < schema.NumField(); i++ {
			field := schema.Field(i)
			fields[strings.Split(field.Tag.Get("json"), ",")[0]] = field
		}
		seen := make(map[string]bool, len(fields))
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return errArcadeFreePlayConfig
			}
			name, ok := key.(string)
			field, known := fields[name]
			if !ok || !known || seen[name] {
				return errArcadeFreePlayConfig
			}
			seen[name] = true
			if strictArcadeFreePlayValue(decoder, field.Type) != nil {
				return errArcadeFreePlayConfig
			}
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
			return errArcadeFreePlayConfig
		}
		for name, field := range fields {
			if !seen[name] && !strings.Contains(field.Tag.Get("json"), ",omitempty") {
				return errArcadeFreePlayConfig
			}
		}
		return nil
	case reflect.String:
		if _, ok := token.(string); ok {
			return nil
		}
	case reflect.Bool:
		if _, ok := token.(bool); ok {
			return nil
		}
	case reflect.Int, reflect.Int64:
		if number, ok := token.(json.Number); ok {
			if _, err := strconv.ParseInt(number.String(), 10, schema.Bits()); err == nil {
				return nil
			}
		}
	}
	return errArcadeFreePlayConfig
}

func (doc arcadeFreePlayConfigDocument) configuration(serverChain string) (*arcadeFreePlayConfig, error) {
	cfg := &arcadeFreePlayConfig{
		Cost:   arcade.FreePlayCostSettings{Target: arcade.FreePlayTarget{ChainID: doc.Cost.Target.ChainID, Realm: doc.Cost.Target.Realm}, GasWanted: doc.Cost.GasWanted, StorageBytes: doc.Cost.StorageBytes, FeeMarginNumerator: doc.Cost.FeeMarginNumerator, FeeMarginDenominator: doc.Cost.FeeMarginDenominator, MaxFeeUgnot: doc.Cost.MaxFeeUgnot, MaxDepositUgnot: doc.Cost.MaxDepositUgnot},
		Budget: arcade.FreePlayBudgetSettings{Signer: doc.Budget.Signer, MaxAttempts: doc.Budget.MaxAttempts, MaxFeeUgnot: doc.Budget.MaxFeeUgnot, MaxDepositUgnot: doc.Budget.MaxDepositUgnot},
		RPCURL: doc.RPCURL, Publish: doc.Publish,
		Limits: arcadeFreePlayLimits{IPRequests: doc.Limits.IPRequests, WalletRequests: doc.Limits.WalletRequests, MaxEntries: doc.Limits.MaxEntries},
		Node:   arcade.Config{NodeBin: doc.Node.NodeBin, Concurrency: doc.Node.Concurrency, MaxOutputBytes: doc.Node.MaxOutputBytes},
	}
	for _, item := range []struct {
		text string
		out  *time.Duration
	}{
		{doc.Cost.MaxPriceAge, &cfg.Cost.MaxPriceAge}, {doc.Cost.QuoteLifetime, &cfg.Cost.QuoteLifetime},
		{doc.RPCBlockAge, &cfg.RPCBlockAge}, {doc.RPCTimeout, &cfg.RPCTimeout},
		{doc.PublishInterval, &cfg.PublishInterval}, {doc.Limits.Window, &cfg.Limits.Window}, {doc.Node.Timeout, &cfg.Node.Timeout},
	} {
		if !arcadeFreePlayDurationText.MatchString(item.text) {
			return nil, errArcadeFreePlayConfig
		}
		value, err := time.ParseDuration(item.text)
		if err != nil || value <= 0 {
			return nil, errArcadeFreePlayConfig
		}
		*item.out = value
	}
	if serverChain == "" || cfg.Cost.Target.ChainID != serverChain || cfg.Cost.Target.Validate() != nil || !validArcadeFreePlayNode(cfg.Node) || strings.TrimSpace(cfg.Node.NodeBin) != cfg.Node.NodeBin || strings.ContainsAny(cfg.Node.NodeBin, "\x00\r\n") || cfg.Limits.IPRequests <= 0 || cfg.Limits.WalletRequests <= 0 || cfg.Limits.MaxEntries < 2 {
		return nil, errArcadeFreePlayConfig
	}
	// NewFreePlayBudget requires a live store. Reuse the public address parser
	// and its exact scalar caps here; the runtime constructor rechecks them.
	signer, err := address.Parse(cfg.Budget.Signer)
	if err != nil || signer.Kind() != address.KindGno || signer.String() != cfg.Budget.Signer {
		return nil, errArcadeFreePlayConfig
	}
	for _, limit := range []int64{cfg.Budget.MaxAttempts, cfg.Budget.MaxFeeUgnot, cfg.Budget.MaxDepositUgnot} {
		if limit <= 0 || limit > arcade.FreePlayMaxScore {
			return nil, errArcadeFreePlayConfig
		}
	}
	if cfg.Cost.MaxFeeUgnot > cfg.Budget.MaxFeeUgnot || cfg.Cost.MaxDepositUgnot > cfg.Budget.MaxDepositUgnot {
		return nil, errArcadeFreePlayConfig
	}
	// These constructors only validate and allocate values; no RPC or prices
	// are read, no economic defaults are invented, and no database is opened.
	prices, err := arcade.NewFreePlayRPCPrices(cfg.RPCURL, cfg.Cost.Target, nil, cfg.RPCBlockAge, nil)
	if err != nil {
		return nil, errArcadeFreePlayConfig
	}
	cost, err := arcade.NewFreePlayCostPolicy(cfg.Cost, prices, func(context.Context, arcade.FreePlayRun, arcade.FreePlayQuote) error { return arcade.ErrFreePlayPaused }, nil)
	if err != nil {
		return nil, errArcadeFreePlayConfig
	}
	_, err = arcade.NewFreePlayRPCChain(arcade.FreePlayChainConfig{Target: cfg.Cost.Target, RPCURL: cfg.RPCURL, Timeout: cfg.RPCTimeout}, nil, nil, cost)
	if err != nil {
		return nil, errArcadeFreePlayConfig
	}
	return cfg, nil
}

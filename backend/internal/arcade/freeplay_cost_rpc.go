package arcade

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// FreePlayRPCPrices reads only public chain prices. It does not inspect keys,
// sign, simulate, broadcast, cache prices or use v1's fallback fee defaults.
type FreePlayRPCPrices struct {
	remote      string
	target      FreePlayTarget
	client      *http.Client
	maxBlockAge time.Duration
	now         func() time.Time
}

func NewFreePlayRPCPrices(remote string, target FreePlayTarget, client *http.Client, maxBlockAge time.Duration, now func() time.Time) (*FreePlayRPCPrices, error) {
	origin, err := url.Parse(remote)
	if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.RawPath != "" || origin.Path != "" && origin.Path != "/" || origin.Scheme != "http" && origin.Scheme != "https" || target.Validate() != nil || maxBlockAge <= 0 {
		return nil, ErrFreePlayPaused
	}
	// Price integrity requires HTTPS outside the explicit local test boundary.
	// Match literal hosts only: no suffixes, LAN hosts or numeric IP aliases.
	if origin.Scheme == "http" {
		host := strings.ToLower(origin.Hostname())
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return nil, ErrFreePlayPaused
		}
	}
	owned := http.Client{Timeout: 5 * time.Second}
	if client != nil {
		owned = *client
		if owned.Timeout <= 0 || owned.Timeout > 5*time.Second {
			owned.Timeout = 5 * time.Second
		}
	}
	owned.Jar = nil
	owned.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if now == nil {
		now = time.Now
	}
	return &FreePlayRPCPrices{strings.TrimRight(remote, "/"), target, &owned, maxBlockAge, now}, nil
}
func (p *FreePlayRPCPrices) get(ctx context.Context, path string, value any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.remote+path, nil)
	if err != nil {
		return ErrFreePlayPrices
	}
	request.Header.Set("Cache-Control", "no-cache")
	response, err := p.client.Do(request)
	if err != nil {
		return ErrFreePlayPrices
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return ErrFreePlayPrices
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		return ErrFreePlayPrices
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if decoder.Decode(value) != nil {
		return ErrFreePlayPrices
	}
	var extra any
	if !errors.Is(decoder.Decode(&extra), io.EOF) {
		return ErrFreePlayPrices
	}
	return nil
}
func priceRPCError(raw json.RawMessage) bool {
	return len(raw) > 0 && string(raw) != "null" && string(raw) != `""`
}
func (p *FreePlayRPCPrices) status(ctx context.Context) (int64, error) {
	var status struct {
		Error  json.RawMessage `json:"error"`
		Result struct {
			NodeInfo struct {
				Network string `json:"network"`
			} `json:"node_info"`
			SyncInfo struct {
				Height     string `json:"latest_block_height"`
				Time       string `json:"latest_block_time"`
				CatchingUp *bool  `json:"catching_up"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if p.get(ctx, "/status", &status) != nil || priceRPCError(status.Error) || status.Result.NodeInfo.Network != p.target.ChainID {
		return 0, ErrFreePlayPrices
	}
	sync := status.Result.SyncInfo
	height, err := strconv.ParseInt(sync.Height, 10, 64)
	timestamp, timeErr := time.Parse(time.RFC3339Nano, sync.Time)
	now := p.now()
	if err != nil || height <= 0 || timeErr != nil || timestamp.After(now) || now.Sub(timestamp) > p.maxBlockAge || sync.CatchingUp == nil || *sync.CatchingUp {
		return 0, ErrFreePlayPrices
	}
	return height, nil
}
func (p *FreePlayRPCPrices) query(ctx context.Context, path string) ([]byte, error) {
	values := url.Values{"path": {strconv.Quote(path)}, "data": {`""`}}
	var envelope struct {
		Error  json.RawMessage `json:"error"`
		Result struct {
			Response struct {
				Base struct {
					Error json.RawMessage `json:"Error"`
					Data  string          `json:"Data"`
				} `json:"ResponseBase"`
			} `json:"response"`
		} `json:"result"`
	}
	if p.get(ctx, "/abci_query?"+values.Encode(), &envelope) != nil || priceRPCError(envelope.Error) || priceRPCError(envelope.Result.Response.Base.Error) {
		return nil, ErrFreePlayPrices
	}
	data, err := base64.StdEncoding.DecodeString(envelope.Result.Response.Base.Data)
	if err != nil || len(data) == 0 {
		return nil, ErrFreePlayPrices
	}
	return data, nil
}
func (p *FreePlayRPCPrices) ReadFreePlayPrices(ctx context.Context, target FreePlayTarget) (FreePlayPrices, error) {
	if target != p.target {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	observed := p.now()
	height, err := p.status(ctx)
	if err != nil {
		return FreePlayPrices{}, err
	}
	raw, err := p.query(ctx, "auth/gasprice")
	if err != nil {
		return FreePlayPrices{}, err
	}
	gas, err := ParseGasPrice(raw)
	if err != nil {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	raw, err = p.query(ctx, "params/vm:p:storage_price")
	if err != nil {
		return FreePlayPrices{}, err
	}
	var coin string
	if json.Unmarshal(raw, &coin) != nil {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	amount, ok := strings.CutSuffix(coin, "ugnot")
	if !ok {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	storage, err := strconv.ParseInt(amount, 10, 64)
	if err != nil || storage <= 0 {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	lastHeight, err := p.status(ctx)
	if err != nil || lastHeight < height || p.now().Sub(observed) > p.maxBlockAge {
		return FreePlayPrices{}, ErrFreePlayPrices
	}
	return FreePlayPrices{Target: target, Height: lastHeight, ObservedAt: observed, GasPrice: gas, StoragePriceUgnot: storage}, nil
}

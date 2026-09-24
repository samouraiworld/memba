package arcade

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Fee sizing for the attester's AttestScore tx. gno.land charges the FULL
// gas-fee on every delivered tx (nothing is refunded for unused gas), and the
// chain only checks fee/gasWanted >= its gas price. So the fee is sized from
// gasWanted × price with a margin for price drift, never a flat 1 GNOT.
const (
	// DefaultAttestGasWanted covers AttestScore on the mainnet realm with room to
	// grow. Measured on a local node at the gnoland-1 ref (e75fef82) with the
	// byte-identical published realm: ~6.6M gas on an empty realm, ~21M after
	// ~90 entries, then ~2M more per doubling of the entry count (three AVL
	// trees are written per call): ~40M at ~30k entries. gnokey simulates before
	// broadcasting, so an undersized value burns no fee, but the run retries
	// and then parks 'errored'.
	DefaultAttestGasWanted = 50_000_000
	// DefaultAttestFeeMargin multiplies the minimum fee the gas price demands,
	// so a moderate rise of the chain's dynamic gas price doesn't reject txs.
	DefaultAttestFeeMargin = 2
	// DefaultMaxAttestFeeUgnot: the attester refuses to start above this
	// per-tx fee unless MEMBA_ARCADE_MAX_GAS_FEE_UGNOT raises it (0.2 GNOT). The
	// default budget costs 100_000 ugnot at today's price, so the live price can
	// double before the attester refuses.
	DefaultMaxAttestFeeUgnot = 200_000

	// DefaultAttestMaxDepositUgnot bounds the storage deposit one AttestScore
	// may lock (gnokey -max-deposit). Unset, the chain falls back to its
	// default_deposit param (100 GNOT on gnoland-1). Measured worst case: 10,290
	// bytes at 100ugnot/byte = 1,029,000 ugnot; ×1.5 rounds up to 2 GNOT. A tx
	// that needs more fails in gnokey's simulation, so it locks and pays nothing.
	DefaultAttestMaxDepositUgnot = 2_000_000
	// MaxAttestMaxDepositUgnot is the hard ceiling on MEMBA_ARCADE_MAX_DEPOSIT_UGNOT (5 GNOT).
	MaxAttestMaxDepositUgnot = 5_000_000
)

// FallbackGasPrice is gnoland-1's auth/gasprice at launch (1ugnot per 1000
// gas), used when the live read at start fails.
var FallbackGasPrice = GasPrice{Gas: 1000, PriceUgnot: 1}

// ErrAttestFeeAboveCap: the resolved per-tx fee exceeds the cap. The attester
// must not start — at up to MaxPerCycle txs per cycle a bad fee drains the key.
var ErrAttestFeeAboveCap = errors.New("arcade: attester gas fee above cap")

// GasPrice is the chain's auth/gasprice: PriceUgnot ugnot per Gas units.
type GasPrice struct {
	Gas        int64
	PriceUgnot int64
}

// ParseGasPrice decodes the auth/gasprice query payload, e.g.
// {"gas":"1000","price":"1ugnot"} (amino JSON: int64s are strings). Only a
// positive ugnot price is usable for sizing.
func ParseGasPrice(data []byte) (GasPrice, error) {
	var raw struct {
		Gas   string `json:"gas"`
		Price string `json:"price"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return GasPrice{}, fmt.Errorf("arcade: parse gasprice: %w", err)
	}
	gas, err := strconv.ParseInt(raw.Gas, 10, 64)
	if err != nil || gas <= 0 {
		return GasPrice{}, fmt.Errorf("arcade: gasprice gas %q must be a positive integer", raw.Gas)
	}
	amount, ok := strings.CutSuffix(raw.Price, "ugnot")
	if !ok {
		return GasPrice{}, fmt.Errorf("arcade: gasprice price %q is not in ugnot", raw.Price)
	}
	price, err := strconv.ParseInt(amount, 10, 64)
	if err != nil || price <= 0 {
		return GasPrice{}, fmt.Errorf("arcade: gasprice price %q must be a positive ugnot amount", raw.Price)
	}
	return GasPrice{Gas: gas, PriceUgnot: price}, nil
}

// MinFeeUgnot is the smallest fee the chain accepts for gasWanted at gp:
// ceil(gasWanted × price / gas), in big.Int so no input can overflow.
func MinFeeUgnot(gasWanted int64, gp GasPrice) *big.Int {
	n := new(big.Int).Mul(big.NewInt(gasWanted), big.NewInt(gp.PriceUgnot))
	d := big.NewInt(gp.Gas)
	q, r := new(big.Int).QuoRem(n, d, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// FeeSettings are the operator knobs; a zero field takes its default.
type FeeSettings struct {
	GasWanted      int64 // MEMBA_ARCADE_GAS_WANTED
	GasFeeUgnot    int64 // MEMBA_ARCADE_GAS_FEE_UGNOT: explicit fee, skips price-derived sizing
	MaxGasFeeUgnot int64 // MEMBA_ARCADE_MAX_GAS_FEE_UGNOT: refuse-to-start cap
}

// FeePlan is the resolved per-tx gas budget.
type FeePlan struct {
	GasWanted   int64
	GasFeeUgnot int64
	Source      string // "env" (explicit fee), "gasprice" (live read), "fallback" (FallbackGasPrice)
}

// PlanAttestFee resolves the per-tx fee. live is the chain's gas price read at
// start (nil when that read failed). An explicit fee wins; otherwise the fee is
// MinFee × DefaultAttestFeeMargin at the live price, else at FallbackGasPrice.
// Errors (the attester must stay dormant) when the fee exceeds the cap, or when
// an explicit fee is below what the live price demands (every tx would bounce).
func PlanAttestFee(s FeeSettings, live *GasPrice) (FeePlan, error) {
	p := FeePlan{GasWanted: s.GasWanted}
	if p.GasWanted <= 0 {
		p.GasWanted = DefaultAttestGasWanted
	}
	maxFee := s.MaxGasFeeUgnot
	if maxFee <= 0 {
		maxFee = DefaultMaxAttestFeeUgnot
	}

	var fee *big.Int
	switch {
	case s.GasFeeUgnot > 0:
		fee, p.Source = big.NewInt(s.GasFeeUgnot), "env"
		if live != nil {
			if lo := MinFeeUgnot(p.GasWanted, *live); fee.Cmp(lo) < 0 {
				return FeePlan{}, fmt.Errorf("arcade: MEMBA_ARCADE_GAS_FEE_UGNOT=%d is below the chain minimum %s ugnot for gas-wanted %d at %dugnot/%d gas",
					s.GasFeeUgnot, lo, p.GasWanted, live.PriceUgnot, live.Gas)
			}
		}
	case live != nil:
		fee, p.Source = MinFeeUgnot(p.GasWanted, *live), "gasprice"
		fee.Mul(fee, big.NewInt(DefaultAttestFeeMargin))
	default:
		fee, p.Source = MinFeeUgnot(p.GasWanted, FallbackGasPrice), "fallback"
		fee.Mul(fee, big.NewInt(DefaultAttestFeeMargin))
	}
	if fee.Cmp(big.NewInt(maxFee)) > 0 {
		return FeePlan{}, fmt.Errorf("%w: %s ugnot per tx (source %s, gas-wanted %d) > cap %d ugnot; raise MEMBA_ARCADE_MAX_GAS_FEE_UGNOT to accept it",
			ErrAttestFeeAboveCap, fee, p.Source, p.GasWanted, maxFee)
	}
	p.GasFeeUgnot = fee.Int64() // <= maxFee, so it fits
	return p, nil
}

// ResolveMaxDeposit parses MEMBA_ARCADE_MAX_DEPOSIT_UGNOT. Empty takes the
// default. Anything else must be a whole ugnot amount in
// (0, MaxAttestMaxDepositUgnot]; otherwise the attester must stay dormant. A 0
// would hand the choice back to the chain's 100 GNOT default_deposit.
func ResolveMaxDeposit(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultAttestMaxDepositUgnot, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 || n > MaxAttestMaxDepositUgnot {
		return 0, fmt.Errorf("arcade: MEMBA_ARCADE_MAX_DEPOSIT_UGNOT=%q must be a whole ugnot amount in 1..%d", raw, MaxAttestMaxDepositUgnot)
	}
	return n, nil
}

// FetchGasPrice reads auth/gasprice from the RPC at remote, after checking the
// node serves chainID: an RPC that answers is not proof it is the chain we sign
// for. Read-only; the caller bounds it with ctx.
func FetchGasPrice(ctx context.Context, client *http.Client, remote, chainID string) (GasPrice, error) {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	base := strings.TrimRight(remote, "/")
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		return GasPrice{}, fmt.Errorf("arcade: gasprice read needs an http(s) RPC URL, got %q", remote)
	}

	var status struct {
		Result struct {
			NodeInfo struct {
				Network string `json:"network"`
			} `json:"node_info"`
		} `json:"result"`
	}
	if err := getJSON(ctx, client, base+"/status", &status); err != nil {
		return GasPrice{}, err
	}
	if got := status.Result.NodeInfo.Network; got != chainID {
		return GasPrice{}, fmt.Errorf("arcade: RPC %s serves network %q, not %q", base, got, chainID)
	}

	var q struct {
		Result struct {
			Response struct {
				ResponseBase struct {
					Error json.RawMessage `json:"Error"`
					Data  string          `json:"Data"`
				} `json:"ResponseBase"`
			} `json:"response"`
		} `json:"result"`
	}
	if err := getJSON(ctx, client, base+"/abci_query?path=%22auth/gasprice%22", &q); err != nil {
		return GasPrice{}, err
	}
	rb := q.Result.Response.ResponseBase
	if len(rb.Error) > 0 && string(rb.Error) != "null" {
		return GasPrice{}, fmt.Errorf("arcade: auth/gasprice query error: %s", rb.Error)
	}
	data, err := base64.StdEncoding.DecodeString(rb.Data)
	if err != nil {
		return GasPrice{}, fmt.Errorf("arcade: auth/gasprice data is not base64: %w", err)
	}
	return ParseGasPrice(data)
}

func getJSON(ctx context.Context, client *http.Client, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("arcade: GET %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("arcade: GET %s: HTTP %d", url, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil {
		return fmt.Errorf("arcade: GET %s: decode: %w", url, err)
	}
	return nil
}

package arcade

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
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
	// MaxAttestGasWanted is the hard ceiling on MEMBA_ARCADE_GAS_WANTED: 20×
	// the default and a third of gnoland-1's 3B block max gas. It also keeps
	// every gas and fee value well inside a 32-bit int.
	MaxAttestGasWanted = 1_000_000_000
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

var (
	// ErrAttestFeeAboveCap: the resolved per-tx fee exceeds the cap. The attester
	// must not start — at up to MaxPerCycle txs per cycle a bad fee drains the key.
	ErrAttestFeeAboveCap = errors.New("arcade: attester gas fee above cap")
	// ErrRPCWrongNetwork: the RPC answered for a different chain than the one
	// the attester signs for. Unlike an unreachable RPC this is a config error,
	// so the attester must not start.
	ErrRPCWrongNetwork = errors.New("arcade: RPC serves a different network")
)

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
// Errors (the attester must stay dormant) when gas-wanted exceeds
// MaxAttestGasWanted, when the fee exceeds the cap, or when an explicit fee is
// below the minimum at the live price (or, with no live read, at the
// FallbackGasPrice floor) — every tx would bounce.
func PlanAttestFee(s FeeSettings, live *GasPrice) (FeePlan, error) {
	p := FeePlan{GasWanted: s.GasWanted}
	if p.GasWanted <= 0 {
		p.GasWanted = DefaultAttestGasWanted
	}
	if p.GasWanted > MaxAttestGasWanted {
		return FeePlan{}, fmt.Errorf("arcade: gas-wanted %d is above the ceiling %d", p.GasWanted, MaxAttestGasWanted)
	}
	maxFee := s.MaxGasFeeUgnot
	if maxFee <= 0 {
		maxFee = DefaultMaxAttestFeeUgnot
	}

	var fee *big.Int
	switch {
	case s.GasFeeUgnot > 0:
		fee, p.Source = big.NewInt(s.GasFeeUgnot), "env"
		floor := FallbackGasPrice
		if live != nil {
			floor = *live
		}
		if lo := MinFeeUgnot(p.GasWanted, floor); fee.Cmp(lo) < 0 {
			return FeePlan{}, fmt.Errorf("arcade: MEMBA_ARCADE_GAS_FEE_UGNOT=%d is below the chain minimum %s ugnot for gas-wanted %d at %dugnot/%d gas",
				s.GasFeeUgnot, lo, p.GasWanted, floor.PriceUgnot, floor.Gas)
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
	n, err := parseEnvAmount("MEMBA_ARCADE_MAX_DEPOSIT_UGNOT", raw, MaxAttestMaxDepositUgnot)
	if err != nil {
		return 0, err
	}
	if n == 0 {
		return DefaultAttestMaxDepositUgnot, nil
	}
	return n, nil
}

// FeeSettingsFromEnv parses the fee knobs strictly: unset (or blank) takes the
// default, anything else must be a whole number in 1..max. A malformed value
// ("50_000", "100000ugnot", "0") is an error, never a silent default, so a
// tighter cap an operator set can't be dropped by a typo.
func FeeSettingsFromEnv(getenv func(string) string) (FeeSettings, error) {
	var s FeeSettings
	var err error
	if s.GasWanted, err = parseEnvAmount("MEMBA_ARCADE_GAS_WANTED", getenv("MEMBA_ARCADE_GAS_WANTED"), MaxAttestGasWanted); err != nil {
		return FeeSettings{}, err
	}
	if s.GasFeeUgnot, err = parseEnvAmount("MEMBA_ARCADE_GAS_FEE_UGNOT", getenv("MEMBA_ARCADE_GAS_FEE_UGNOT"), math.MaxInt64); err != nil {
		return FeeSettings{}, err
	}
	if s.MaxGasFeeUgnot, err = parseEnvAmount("MEMBA_ARCADE_MAX_GAS_FEE_UGNOT", getenv("MEMBA_ARCADE_MAX_GAS_FEE_UGNOT"), math.MaxInt64); err != nil {
		return FeeSettings{}, err
	}
	return s, nil
}

// parseEnvAmount returns 0 for an unset/blank value (take the default) and
// otherwise requires a base-10 integer in 1..max.
func parseEnvAmount(name, raw string, max int64) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 || n > max {
		return 0, fmt.Errorf("arcade: %s=%q must be a whole number in 1..%d", name, raw, max)
	}
	return n, nil
}

// AttestBudget is everything the attester's gnokey call spends per tx.
type AttestBudget struct {
	FeePlan
	MaxDepositUgnot int64
	// GasPriceErr is the (non-fatal) auth/gasprice read failure that made the
	// plan use FallbackGasPrice; nil when the live price was used.
	GasPriceErr error
}

// ResolveAttestBudget reads the knobs from getenv, the gas price from remote,
// and returns the per-tx budget. Any error means the attester must stay
// dormant: a malformed knob, a fee or deposit outside its bounds, or an RPC
// that serves a different chain than chainID. An unreachable RPC is not fatal —
// the fee is sized from FallbackGasPrice and GasPriceErr says why.
func ResolveAttestBudget(ctx context.Context, client *http.Client, getenv func(string) string, remote, chainID string) (AttestBudget, error) {
	settings, err := FeeSettingsFromEnv(getenv)
	if err != nil {
		return AttestBudget{}, err
	}
	maxDeposit, err := ResolveMaxDeposit(getenv("MEMBA_ARCADE_MAX_DEPOSIT_UGNOT"))
	if err != nil {
		return AttestBudget{}, err
	}
	var live *GasPrice
	gp, gpErr := FetchGasPrice(ctx, client, remote, chainID)
	switch {
	case errors.Is(gpErr, ErrRPCWrongNetwork):
		return AttestBudget{}, gpErr
	case gpErr == nil:
		live = &gp
	}
	plan, err := PlanAttestFee(settings, live)
	if err != nil {
		return AttestBudget{}, err
	}
	return AttestBudget{FeePlan: plan, MaxDepositUgnot: maxDeposit, GasPriceErr: gpErr}, nil
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
	switch got := status.Result.NodeInfo.Network; {
	case got == "":
		return GasPrice{}, fmt.Errorf("arcade: RPC %s status has no node_info.network", base)
	case got != chainID:
		return GasPrice{}, fmt.Errorf("%w: %s serves %q, not %q", ErrRPCWrongNetwork, base, got, chainID)
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

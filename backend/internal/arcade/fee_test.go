package arcade

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseGasPrice(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    GasPrice
		wantErr bool
	}{
		// The exact payload gnoland-1 returned on 2026-09-24 (h292115).
		{name: "gnoland-1 launch price", in: "{\n  \"gas\": \"1000\",\n  \"price\": \"1ugnot\"\n}", want: GasPrice{Gas: 1000, PriceUgnot: 1}},
		{name: "raised price", in: `{"gas":"1000","price":"7ugnot"}`, want: GasPrice{Gas: 1000, PriceUgnot: 7}},
		{name: "not json", in: `garbage`, wantErr: true},
		{name: "empty object", in: `{}`, wantErr: true},
		{name: "zero gas", in: `{"gas":"0","price":"1ugnot"}`, wantErr: true},
		{name: "negative gas", in: `{"gas":"-1000","price":"1ugnot"}`, wantErr: true},
		{name: "zero price", in: `{"gas":"1000","price":"0ugnot"}`, wantErr: true},
		{name: "other denom", in: `{"gas":"1000","price":"1uatom"}`, wantErr: true},
		{name: "no amount", in: `{"gas":"1000","price":"ugnot"}`, wantErr: true},
		{name: "decimal price", in: `{"gas":"1000","price":"0.5ugnot"}`, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseGasPrice([]byte(tc.in))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error, got %+v", got)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestMinFeeUgnot(t *testing.T) {
	cases := []struct {
		gasWanted int64
		gp        GasPrice
		want      string
	}{
		{5_000_000, GasPrice{1000, 1}, "5000"},
		{50_000_000, GasPrice{1000, 1}, "50000"},
		{1_500, GasPrice{1000, 1}, "2"}, // rounds UP: 1.5 ugnot would be rejected
		{1, GasPrice{1000, 1}, "1"},
		{9_223_372_036_854_775_807, GasPrice{1, 9_223_372_036_854_775_807}, "85070591730234615847396907784232501249"}, // no overflow
	}
	for _, tc := range cases {
		if got := MinFeeUgnot(tc.gasWanted, tc.gp).String(); got != tc.want {
			t.Errorf("MinFeeUgnot(%d, %+v) = %s, want %s", tc.gasWanted, tc.gp, got, tc.want)
		}
	}
}

func TestPlanAttestFee(t *testing.T) {
	launch := &GasPrice{Gas: 1000, PriceUgnot: 1}
	doubled := &GasPrice{Gas: 1000, PriceUgnot: 2}
	tripled := &GasPrice{Gas: 1000, PriceUgnot: 3}
	cases := []struct {
		name     string
		s        FeeSettings
		live     *GasPrice
		want     FeePlan
		wantCap  bool // ErrAttestFeeAboveCap
		wantFail bool // any other refusal
	}{
		{name: "default, live price", live: launch,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 100_000, Source: "gasprice"}},
		{name: "default, read failed", live: nil,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 100_000, Source: "fallback"}},
		{name: "gas wanted override", s: FeeSettings{GasWanted: 5_000_000}, live: launch,
			want: FeePlan{GasWanted: 5_000_000, GasFeeUgnot: 10_000, Source: "gasprice"}},
		{name: "odd gas wanted rounds up before the margin", s: FeeSettings{GasWanted: 1_500}, live: launch,
			want: FeePlan{GasWanted: 1_500, GasFeeUgnot: 4, Source: "gasprice"}},
		{name: "live price doubled still under the default cap", live: doubled,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 200_000, Source: "gasprice"}},
		{name: "live price tripled refuses", live: tripled, wantCap: true},
		{name: "cap override accepts it", s: FeeSettings{MaxGasFeeUgnot: 300_000}, live: tripled,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 300_000, Source: "gasprice"}},
		{name: "explicit fee wins over the live price", s: FeeSettings{GasFeeUgnot: 60_000}, live: launch,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 60_000, Source: "env"}},
		{name: "explicit fee without a live read", s: FeeSettings{GasFeeUgnot: 60_000}, live: nil,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 60_000, Source: "env"}},
		{name: "the old flat 1 GNOT refuses", s: FeeSettings{GasFeeUgnot: 1_000_000}, live: launch, wantCap: true},
		{name: "the old flat 1 GNOT with an explicit cap", s: FeeSettings{GasFeeUgnot: 1_000_000, MaxGasFeeUgnot: 1_000_000}, live: launch,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 1_000_000, Source: "env"}},
		{name: "explicit fee below the live minimum refuses", s: FeeSettings{GasFeeUgnot: 49_999}, live: launch, wantFail: true},
		{name: "explicit fee at the live minimum", s: FeeSettings{GasFeeUgnot: 50_000}, live: launch,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 50_000, Source: "env"}},
		{name: "explicit fee below the floor without a live read refuses", s: FeeSettings{GasFeeUgnot: 49_999}, live: nil, wantFail: true},
		{name: "gas wanted at the ceiling with a raised cap", s: FeeSettings{GasWanted: 1_000_000_000, MaxGasFeeUgnot: 2_000_000}, live: launch,
			want: FeePlan{GasWanted: 1_000_000_000, GasFeeUgnot: 2_000_000, Source: "gasprice"}},
		{name: "gas wanted above the ceiling refuses even with an explicit fee", s: FeeSettings{GasWanted: 1_000_000_001, GasFeeUgnot: 150_000}, live: nil, wantFail: true},
		{name: "chain block max gas refuses", s: FeeSettings{GasWanted: 3_000_000_000}, live: launch, wantFail: true},
		{name: "negative knobs take defaults", s: FeeSettings{GasWanted: -1, GasFeeUgnot: -1, MaxGasFeeUgnot: -1}, live: launch,
			want: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 100_000, Source: "gasprice"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := PlanAttestFee(tc.s, tc.live)
			switch {
			case tc.wantCap:
				if !errors.Is(err, ErrAttestFeeAboveCap) {
					t.Fatalf("want ErrAttestFeeAboveCap, got %+v, %v", got, err)
				}
			case tc.wantFail:
				if err == nil || errors.Is(err, ErrAttestFeeAboveCap) {
					t.Fatalf("want a below-minimum refusal, got %+v, %v", got, err)
				}
			default:
				if err != nil || got != tc.want {
					t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
				}
			}
		})
	}
}

// The zero-config broadcaster must never fall back to the old flat 1 GNOT, and
// its derived fee is capped like the env path's.
func TestAttesterConfigDefaultFee(t *testing.T) {
	cases := []struct {
		name      string
		in        AttesterConfig
		wantGas   int64
		wantFee   int64
		wantDepos int64
	}{
		{"zero config", AttesterConfig{}, DefaultAttestGasWanted, 100_000, DefaultAttestMaxDepositUgnot},
		{"small gas", AttesterConfig{GasWanted: 5_000_000}, 5_000_000, 10_000, DefaultAttestMaxDepositUgnot},
		{"derived fee above the cap is capped", AttesterConfig{GasWanted: 150_000_000}, 150_000_000, DefaultMaxAttestFeeUgnot, DefaultAttestMaxDepositUgnot},
		{"gas above the ceiling is capped", AttesterConfig{GasWanted: 5_000_000_000}, 5_000_000_000, DefaultMaxAttestFeeUgnot, DefaultAttestMaxDepositUgnot},
		{"explicit values kept", AttesterConfig{GasWanted: 3, GasFeeUgnot: 7, MaxDepositUgnot: 9}, 3, 7, 9},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := tc.in.withDefaults()
			if c.GasWanted != tc.wantGas || c.GasFeeUgnot != tc.wantFee || c.MaxDepositUgnot != tc.wantDepos {
				t.Fatalf("got gas %d fee %d deposit %d; want %d / %d / %d",
					c.GasWanted, c.GasFeeUgnot, c.MaxDepositUgnot, tc.wantGas, tc.wantFee, tc.wantDepos)
			}
		})
	}
}

func envMap(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestFeeSettingsFromEnv(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		want    FeeSettings
		wantErr string
	}{
		{name: "unset takes defaults", env: nil, want: FeeSettings{}},
		{name: "blank takes defaults", env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": " "}, want: FeeSettings{}},
		{name: "all set", env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": "40000000", "MEMBA_ARCADE_GAS_FEE_UGNOT": "90000", "MEMBA_ARCADE_MAX_GAS_FEE_UGNOT": "150000"},
			want: FeeSettings{GasWanted: 40_000_000, GasFeeUgnot: 90_000, MaxGasFeeUgnot: 150_000}},
		{name: "gas at the ceiling", env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": "1000000000"}, want: FeeSettings{GasWanted: 1_000_000_000}},
		{name: "gas above the ceiling", env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": "1000000001"}, wantErr: "MEMBA_ARCADE_GAS_WANTED"},
		{name: "underscore digits", env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": "50_000"}, wantErr: "MEMBA_ARCADE_GAS_WANTED"},
		{name: "coin string fee", env: map[string]string{"MEMBA_ARCADE_GAS_FEE_UGNOT": "100000ugnot"}, wantErr: "MEMBA_ARCADE_GAS_FEE_UGNOT"},
		{name: "zero fee", env: map[string]string{"MEMBA_ARCADE_GAS_FEE_UGNOT": "0"}, wantErr: "MEMBA_ARCADE_GAS_FEE_UGNOT"},
		// The case this guards: a tighter cap lost to a typo would silently
		// revert to the 200000 default.
		{name: "malformed cap", env: map[string]string{"MEMBA_ARCADE_MAX_GAS_FEE_UGNOT": "50k"}, wantErr: "MEMBA_ARCADE_MAX_GAS_FEE_UGNOT"},
		{name: "negative cap", env: map[string]string{"MEMBA_ARCADE_MAX_GAS_FEE_UGNOT": "-5"}, wantErr: "MEMBA_ARCADE_MAX_GAS_FEE_UGNOT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := FeeSettingsFromEnv(envMap(tc.env))
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("want an error naming %s, got %+v, %v", tc.wantErr, got, err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestResolveAttestBudget(t *testing.T) {
	const live = `{"gas":"1000","price":"1ugnot"}`
	good := rpcStub(t, "gnoland-1", live, "null")
	other := rpcStub(t, "gnoland-0", live, "null")
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}))
	t.Cleanup(down.Close)

	cases := []struct {
		name       string
		srv        *httptest.Server
		env        map[string]string
		want       AttestBudget
		wantGPErr  bool
		wantErrIs  error
		wantErrAny bool
	}{
		{name: "live price", srv: good,
			want: AttestBudget{FeePlan: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 100_000, Source: "gasprice"}, MaxDepositUgnot: 2_000_000}},
		{name: "overrides", srv: good, env: map[string]string{"MEMBA_ARCADE_GAS_WANTED": "20000000", "MEMBA_ARCADE_MAX_DEPOSIT_UGNOT": "1500000"},
			want: AttestBudget{FeePlan: FeePlan{GasWanted: 20_000_000, GasFeeUgnot: 40_000, Source: "gasprice"}, MaxDepositUgnot: 1_500_000}},
		{name: "unreachable RPC falls back", srv: down, wantGPErr: true,
			want: AttestBudget{FeePlan: FeePlan{GasWanted: 50_000_000, GasFeeUgnot: 100_000, Source: "fallback"}, MaxDepositUgnot: 2_000_000}},
		{name: "wrong network refuses", srv: other, wantErrIs: ErrRPCWrongNetwork},
		{name: "malformed knob refuses", srv: good, env: map[string]string{"MEMBA_ARCADE_MAX_GAS_FEE_UGNOT": "100000ugnot"}, wantErrAny: true},
		{name: "bad deposit refuses", srv: good, env: map[string]string{"MEMBA_ARCADE_MAX_DEPOSIT_UGNOT": "0"}, wantErrAny: true},
		{name: "fee above a tightened cap refuses", srv: good, env: map[string]string{"MEMBA_ARCADE_MAX_GAS_FEE_UGNOT": "50000"}, wantErrIs: ErrAttestFeeAboveCap},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolveAttestBudget(context.Background(), tc.srv.Client(), envMap(tc.env), tc.srv.URL, "gnoland-1")
			switch {
			case tc.wantErrIs != nil:
				if !errors.Is(err, tc.wantErrIs) {
					t.Fatalf("want %v, got %+v, %v", tc.wantErrIs, got, err)
				}
				return
			case tc.wantErrAny:
				if err == nil {
					t.Fatalf("want a refusal, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if (got.GasPriceErr != nil) != tc.wantGPErr {
				t.Fatalf("GasPriceErr = %v, want set=%v", got.GasPriceErr, tc.wantGPErr)
			}
			got.GasPriceErr = nil
			if got != tc.want {
				t.Fatalf("got %+v; want %+v", got, tc.want)
			}
		})
	}
}

// rpcStub serves /status and /abci_query like a gno RPC node.
func rpcStub(t *testing.T, network, gaspriceData, queryErr string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = fmt.Fprintf(w, `{"jsonrpc":"2.0","id":"","result":{"node_info":{"network":%q}}}`, network)
		case "/abci_query":
			if got := r.URL.Query().Get("path"); got != `"auth/gasprice"` {
				t.Errorf("abci_query path = %q", got)
			}
			_, _ = fmt.Fprintf(w, `{"jsonrpc":"2.0","id":"","result":{"response":{"ResponseBase":{"Error":%s,"Data":%q}}}}`,
				queryErr, base64.StdEncoding.EncodeToString([]byte(gaspriceData)))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchGasPrice(t *testing.T) {
	const live = "{\n  \"gas\": \"1000\",\n  \"price\": \"1ugnot\"\n}"
	cases := []struct {
		name     string
		network  string
		data     string
		queryErr string
		remote   func(url string) string
		want     GasPrice
		errPart  string
	}{
		{name: "gnoland-1", network: "gnoland-1", data: live, queryErr: "null", want: GasPrice{1000, 1}},
		{name: "trailing slash", network: "gnoland-1", data: live, queryErr: "null",
			remote: func(u string) string { return u + "/" }, want: GasPrice{1000, 1}},
		{name: "wrong chain", network: "gnoland-0", data: live, queryErr: "null", errPart: `serves "gnoland-0"`},
		{name: "query error", network: "gnoland-1", data: "", queryErr: `{"msg":"unknown"}`, errPart: "query error"},
		{name: "bad payload", network: "gnoland-1", data: `{"gas":"1000","price":"1uatom"}`, queryErr: "null", errPart: "not in ugnot"},
		{name: "not http", network: "gnoland-1", data: live, queryErr: "null",
			remote: func(u string) string { return "tcp://" + strings.TrimPrefix(u, "http://") }, errPart: "http(s)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := rpcStub(t, tc.network, tc.data, tc.queryErr)
			remote := srv.URL
			if tc.remote != nil {
				remote = tc.remote(remote)
			}
			got, err := FetchGasPrice(context.Background(), srv.Client(), remote, "gnoland-1")
			if tc.errPart != "" {
				if err == nil || !strings.Contains(err.Error(), tc.errPart) {
					t.Fatalf("want error containing %q, got %+v, %v", tc.errPart, got, err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestFetchGasPrice_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "gateway timeout", http.StatusGatewayTimeout)
	}))
	t.Cleanup(srv.Close)
	if _, err := FetchGasPrice(context.Background(), srv.Client(), srv.URL, "gnoland-1"); err == nil || !strings.Contains(err.Error(), "504") {
		t.Fatalf("want an HTTP 504 error, got %v", err)
	}
}

func TestResolveMaxDeposit(t *testing.T) {
	cases := []struct {
		raw     string
		want    int64
		wantErr bool
	}{
		{raw: "", want: 2_000_000},           // default: 1.5× the measured worst 10,290 bytes, rounded up
		{raw: "  ", want: 2_000_000},         // blank counts as unset
		{raw: "1500000", want: 1_500_000},    // override
		{raw: "5000000", want: 5_000_000},    // at the hard ceiling
		{raw: "0", wantErr: true},            // would hand the cap back to the chain's 100 GNOT default
		{raw: "-1", wantErr: true},           // negative
		{raw: "5000001", wantErr: true},      // above the 5 GNOT ceiling
		{raw: "100000000", wantErr: true},    // the chain default, 100 GNOT
		{raw: "2000000ugnot", wantErr: true}, // a coin string, not a bare amount
		{raw: "2e6", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ResolveMaxDeposit(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want a refusal, got %d", got)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %d, %v; want %d", got, err, tc.want)
			}
		})
	}
}

// The production broadcaster always passes -max-deposit, so no attestation can
// fall back to the chain's 100 GNOT default_deposit.
func TestGnokeyBroadcaster_AlwaysCapsDeposit(t *testing.T) {
	for _, tc := range []struct {
		cfg  AttesterConfig
		want string
	}{
		{AttesterConfig{}, "2000000ugnot"},
		{AttesterConfig{MaxDepositUgnot: 1_200_000}, "1200000ugnot"},
	} {
		b := NewGnokeyBroadcaster(tc.cfg).(*gnokeyBroadcaster)
		argv := b.attestScoreArgv(Run{Game: "invaders", Addr: "g1abc", Day: "2026-09-24", Seed: "s", SimVersion: 1, StateHash: "h", LogHash: "l"})
		got := ""
		for i := 0; i+1 < len(argv); i++ {
			if argv[i] == "-max-deposit" {
				got = argv[i+1]
			}
		}
		if got != tc.want {
			t.Fatalf("-max-deposit = %q, want %q (argv %v)", got, tc.want, argv)
		}
	}
}

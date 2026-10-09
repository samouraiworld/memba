package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
)

func freePlayConfigDocumentForTest(t *testing.T) arcadeFreePlayConfigDocument {
	t.Helper()
	raw, err := os.ReadFile("../../internal/arcade/testdata/freeplay/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Runs []struct {
			Target arcade.FreePlayTarget
			Player string
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil || len(fixture.Runs) == 0 {
		t.Fatal("test fixture unavailable", err)
	}
	var doc arcadeFreePlayConfigDocument
	doc.Cost.Target.ChainID = fixture.Runs[0].Target.ChainID
	doc.Cost.Target.Realm = fixture.Runs[0].Target.Realm
	doc.Cost.GasWanted, doc.Cost.StorageBytes = 101, 7
	doc.Cost.FeeMarginNumerator, doc.Cost.FeeMarginDenominator = 3, 2
	doc.Cost.MaxFeeUgnot, doc.Cost.MaxDepositUgnot = 100, 100
	doc.Cost.MaxPriceAge, doc.Cost.QuoteLifetime = "1m", "1m"
	doc.Budget.Signer = fixture.Runs[0].Player
	doc.Budget.MaxAttempts, doc.Budget.MaxFeeUgnot, doc.Budget.MaxDepositUgnot = 2, 200, 200
	doc.RPCURL, doc.RPCBlockAge, doc.RPCTimeout, doc.PublishInterval = "https://rpc.example.invalid", "1m", "1s", "1h"
	doc.Limits.IPRequests, doc.Limits.WalletRequests, doc.Limits.MaxEntries, doc.Limits.Window = 100, 100, 32, "1m"
	doc.Node.NodeBin, doc.Node.Timeout, doc.Node.Concurrency, doc.Node.MaxOutputBytes = "unused-test-node", "1s", 1, 65536
	return doc
}

func freePlayConfigRawForTest(t *testing.T, doc arcadeFreePlayConfigDocument) string {
	t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func freePlayConfigReaderForTest(raw string) func(string) (io.ReadCloser, error) {
	return func(string) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(raw)), nil }
}

func TestArcadeFreePlayConfigAbsentHasNoIO(t *testing.T) {
	cfg, broadcast, err := loadArcadeFreePlayConfig("", "", arcadeFreePlayConfigIO{
		Open:      func(string) (io.ReadCloser, error) { t.Fatal("off opened file"); return nil, nil },
		LookupEnv: func(string) (string, bool) { t.Fatal("off read secret"); return "", false },
		BroadcastFactory: func(string, string, func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error) {
			t.Fatal("off constructed signer")
			return nil, nil
		},
	})
	if cfg != nil || broadcast != nil || err != nil {
		t.Fatal("absent config is not dormant", err)
	}
}

func TestArcadeFreePlayConfigStrictDocument(t *testing.T) {
	doc := freePlayConfigDocumentForTest(t)
	valid := freePlayConfigRawForTest(t, doc)
	cases := map[string]string{
		"empty": "", "null": "null", "array": "[]", "trailing value": valid + " {}", "trailing garbage": valid + "x",
		"unknown":             strings.Replace(valid, `"publish":false`, `"publish":false,"secret":"SYNTHETIC_PRIVATE"`, 1),
		"duplicate":           strings.Replace(valid, `"publish":false`, `"publish":false,"publish":true`, 1),
		"escaped duplicate":   strings.Replace(valid, `"publish":false`, `"publish":false,"\u0070ublish":false`, 1),
		"nested duplicate":    strings.Replace(valid, `"gasWanted":101`, `"gasWanted":101,"gasWanted":102`, 1),
		"case alias":          strings.Replace(valid, `"publish":false`, `"Publish":false`, 1),
		"nested case alias":   strings.Replace(valid, `"gasWanted":101`, `"GasWanted":101`, 1),
		"missing publish":     strings.Replace(valid, `"publish":false,`, "", 1),
		"null publish":        strings.Replace(valid, `"publish":false`, `"publish":null`, 1),
		"string bool":         strings.Replace(valid, `"publish":false`, `"publish":"false"`, 1),
		"float integer":       strings.Replace(valid, `"gasWanted":101`, `"gasWanted":101.0`, 1),
		"exponent integer":    strings.Replace(valid, `"gasWanted":101`, `"gasWanted":1e2`, 1),
		"string integer":      strings.Replace(valid, `"gasWanted":101`, `"gasWanted":"101"`, 1),
		"overflow integer":    strings.Replace(valid, `"gasWanted":101`, `"gasWanted":9223372036854775808`, 1),
		"null integer":        strings.Replace(valid, `"gasWanted":101`, `"gasWanted":null`, 1),
		"numeric duration":    strings.Replace(valid, `"rpcTimeout":"1s"`, `"rpcTimeout":1000000000`, 1),
		"fraction duration":   strings.Replace(valid, `"rpcTimeout":"1s"`, `"rpcTimeout":"0.5s"`, 1),
		"duration overflow":   strings.Replace(valid, `"rpcTimeout":"1s"`, `"rpcTimeout":"9223372036854775808ns"`, 1),
		"duration whitespace": strings.Replace(valid, `"rpcTimeout":"1s"`, `"rpcTimeout":" 1s"`, 1),
		"duration sign":       strings.Replace(valid, `"rpcTimeout":"1s"`, `"rpcTimeout":"+1s"`, 1),
		"null reference":      strings.TrimSuffix(valid, "}") + `,"gnokeyBinary":null}`,
		"invalid UTF8":        valid + string([]byte{0xff}),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, broadcast, err := loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{
				Open:      freePlayConfigReaderForTest(raw),
				LookupEnv: func(string) (string, bool) { t.Fatal("invalid config read secret"); return "", false },
				BroadcastFactory: func(string, string, func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error) {
					t.Fatal("invalid config reached signer")
					return nil, nil
				},
			})
			if cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig {
				t.Fatalf("must refuse with constant diagnostic: %v", err)
			}
		})
	}
}

func TestArcadeFreePlayConfigParameterBoundaries(t *testing.T) {
	for name, mutate := range map[string]func(*arcadeFreePlayConfigDocument){
		"chain":                   func(d *arcadeFreePlayConfigDocument) { d.Cost.Target.ChainID = "different-chain" },
		"realm":                   func(d *arcadeFreePlayConfigDocument) { d.Cost.Target.Realm = "gno.land/r/other" },
		"remote HTTP":             func(d *arcadeFreePlayConfigDocument) { d.RPCURL = "http://rpc.example.invalid" },
		"remote credentials":      func(d *arcadeFreePlayConfigDocument) { d.RPCURL = "https://user:secret@rpc.example.invalid" },
		"remote path":             func(d *arcadeFreePlayConfigDocument) { d.RPCURL += "/path" },
		"remote query":            func(d *arcadeFreePlayConfigDocument) { d.RPCURL += "?token=secret" },
		"remote fragment":         func(d *arcadeFreePlayConfigDocument) { d.RPCURL += "#secret" },
		"loopback suffix":         func(d *arcadeFreePlayConfigDocument) { d.RPCURL = "http://localhost.example.invalid" },
		"timeout":                 func(d *arcadeFreePlayConfigDocument) { d.RPCTimeout = "46s" },
		"zero cadence":            func(d *arcadeFreePlayConfigDocument) { d.PublishInterval = "0s" },
		"quote duration":          func(d *arcadeFreePlayConfigDocument) { d.Cost.QuoteLifetime = "1ms" },
		"gas":                     func(d *arcadeFreePlayConfigDocument) { d.Cost.GasWanted = 0 },
		"storage":                 func(d *arcadeFreePlayConfigDocument) { d.Cost.StorageBytes = -1 },
		"margin":                  func(d *arcadeFreePlayConfigDocument) { d.Cost.FeeMarginNumerator = 1 },
		"denominator":             func(d *arcadeFreePlayConfigDocument) { d.Cost.FeeMarginDenominator = 0 },
		"fee versus daily":        func(d *arcadeFreePlayConfigDocument) { d.Cost.MaxFeeUgnot = 201 },
		"deposit versus daily":    func(d *arcadeFreePlayConfigDocument) { d.Cost.MaxDepositUgnot = 201 },
		"daily max":               func(d *arcadeFreePlayConfigDocument) { d.Budget.MaxAttempts = arcade.FreePlayMaxScore + 1 },
		"daily zero":              func(d *arcadeFreePlayConfigDocument) { d.Budget.MaxDepositUgnot = 0 },
		"signer alias":            func(d *arcadeFreePlayConfigDocument) { d.Budget.Signer = "arcade" },
		"EVM signer":              func(d *arcadeFreePlayConfigDocument) { d.Budget.Signer = "0x1111111111111111111111111111111111111111" },
		"missing signer":          func(d *arcadeFreePlayConfigDocument) { d.Budget.Signer = "" },
		"node binary":             func(d *arcadeFreePlayConfigDocument) { d.Node.NodeBin = "" },
		"node limit":              func(d *arcadeFreePlayConfigDocument) { d.Node.Concurrency = 0 },
		"node output":             func(d *arcadeFreePlayConfigDocument) { d.Node.MaxOutputBytes = 0 },
		"IP quota":                func(d *arcadeFreePlayConfigDocument) { d.Limits.IPRequests = 0 },
		"wallet quota":            func(d *arcadeFreePlayConfigDocument) { d.Limits.WalletRequests = -1 },
		"capacity":                func(d *arcadeFreePlayConfigDocument) { d.Limits.MaxEntries = 1 },
		"publication refs absent": func(d *arcadeFreePlayConfigDocument) { d.Publish = true },
		"off keyring reference":   func(d *arcadeFreePlayConfigDocument) { v := "/synthetic/keyring"; d.KeyringHome = &v },
		"off empty reference":     func(d *arcadeFreePlayConfigDocument) { v := ""; d.GnokeyBinary = &v },
		"relative binary": func(d *arcadeFreePlayConfigDocument) {
			a, b := "gnokey", "/synthetic/keyring"
			d.Publish = true
			d.GnokeyBinary, d.KeyringHome = &a, &b
		},
	} {
		t.Run(name, func(t *testing.T) {
			doc := freePlayConfigDocumentForTest(t)
			chain := doc.Cost.Target.ChainID
			mutate(&doc)
			cfg, broadcast, err := loadArcadeFreePlayConfig("/synthetic/config.json", chain, arcadeFreePlayConfigIO{Open: freePlayConfigReaderForTest(freePlayConfigRawForTest(t, doc)), LookupEnv: func(string) (string, bool) { t.Fatal("invalid config read secret"); return "", false }})
			if cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig {
				t.Fatalf("invalid settings accepted: %v", err)
			}
		})
	}
	for _, remote := range []string{"https://rpc.example.invalid", "http://localhost:26657", "http://127.0.0.1:26657", "http://[::1]:26657"} {
		t.Run(remote, func(t *testing.T) {
			doc := freePlayConfigDocumentForTest(t)
			doc.RPCURL = remote
			doc.Node.Timeout = "1s500ms"
			cfg, broadcast, err := loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{Open: freePlayConfigReaderForTest(freePlayConfigRawForTest(t, doc)), LookupEnv: func(string) (string, bool) { t.Fatal("Publish=false read secret"); return "", false }, BroadcastFactory: func(string, string, func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error) {
				t.Fatal("Publish=false constructed signer")
				return nil, nil
			}})
			if err != nil || cfg == nil || cfg.Publish || broadcast != nil || cfg.Node.Timeout != 1500*time.Millisecond || cfg.Budget.Signer != doc.Budget.Signer || cfg.RPCURL != remote || cfg.Cost.GasWanted != 101 {
				t.Fatalf("valid explicit settings lost: %+v %v", cfg, err)
			}
		})
	}
}

type freePlayConfigReadCloser struct {
	io.Reader
	closed   int
	closeErr error
}

func (r *freePlayConfigReadCloser) Close() error { r.closed++; return r.closeErr }

func TestArcadeFreePlayConfigBoundedReadAndRedactedErrors(t *testing.T) {
	doc := freePlayConfigDocumentForTest(t)
	for _, path := range []string{"relative.json", "/synthetic/secret\n.json", "/synthetic/secret\x00.json"} {
		cfg, broadcast, err := loadArcadeFreePlayConfig(path, doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{Open: func(string) (io.ReadCloser, error) { t.Fatal("invalid path opened"); return nil, nil }})
		if cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig {
			t.Fatal("invalid path accepted", err)
		}
	}
	oversized := strings.NewReader(strings.Repeat(" ", arcadeFreePlayConfigMaxSize+100))
	reader := &freePlayConfigReadCloser{Reader: oversized}
	cfg, broadcast, err := loadArcadeFreePlayConfig("/SYNTHETIC_PRIVATE/config.json", doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{Open: func(string) (io.ReadCloser, error) { return reader, nil }})
	if cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig || reader.closed != 1 || oversized.Len() != 99 {
		t.Fatalf("bounded reader contract: err=%v close=%d left=%d", err, reader.closed, oversized.Len())
	}
	for _, opening := range []bool{true, false} {
		reader := &freePlayConfigReadCloser{Reader: strings.NewReader(freePlayConfigRawForTest(t, doc)), closeErr: errors.New("SYNTHETIC_PRIVATE close")}
		cfg, broadcast, err := loadArcadeFreePlayConfig("/SYNTHETIC_PRIVATE/config.json", doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{Open: func(string) (io.ReadCloser, error) {
			if opening {
				return nil, errors.New("SYNTHETIC_PRIVATE open")
			}
			return reader, nil
		}})
		if cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig || strings.Contains(err.Error(), "SYNTHETIC_PRIVATE") {
			t.Fatal("I/O error disclosed", err)
		}
	}
	// Exercise only a synthetic regular file through the default reader.
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(freePlayConfigRawForTest(t, doc)), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, broadcast, err = loadArcadeFreePlayConfig(path, doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{})
	if err != nil || cfg == nil || broadcast != nil {
		t.Fatal("synthetic file rejected", err)
	}
	if _, _, err = loadArcadeFreePlayConfig(filepath.Dir(path), doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{}); err != errArcadeFreePlayConfig {
		t.Fatal("directory accepted", err)
	}
}

func TestArcadeFreePlayConfigSecretIsDeferredBoundedAndDedicated(t *testing.T) {
	doc := freePlayConfigDocumentForTest(t)
	doc.Publish = true
	binary, home := "/synthetic/bin/gnokey", "/synthetic/keyring"
	doc.GnokeyBinary, doc.KeyringHome = &binary, &home
	value, present := "SYNTHETIC_PRIVATE_PASSWORD", true
	reads := 0
	var password func(context.Context) (string, error)
	factoryCalls := 0
	deps := arcadeFreePlayConfigIO{Open: freePlayConfigReaderForTest(freePlayConfigRawForTest(t, doc)), LookupEnv: func(name string) (string, bool) {
		reads++
		if name != arcadeFreePlayPasswordEnv {
			t.Fatal("wrong secret authority", name)
		}
		return value, present
	}, BroadcastFactory: func(gotBinary, gotHome string, callback func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error) {
		factoryCalls++
		if gotBinary != binary || gotHome != home {
			t.Fatal("references changed")
		}
		password = callback
		return func(ctx context.Context, args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), value) {
				t.Fatal("secret leaked into argv")
			}
			secret, err := callback(ctx)
			if err != nil {
				return "", err
			}
			if secret != value {
				t.Fatal("wrong callback secret")
			}
			return "synthetic-output", nil
		}, nil
	}}
	cfg, broadcast, err := loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, deps)
	if err != nil || cfg == nil || !cfg.Publish || broadcast == nil || password == nil || factoryCalls != 1 || reads != 0 {
		t.Fatal("eager secret or missing broadcast", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if secret, err := password(cancelled); secret != "" || err != errArcadeFreePlaySecret || reads != 0 {
		t.Fatal("cancelled call read secret", err)
	}
	if out, err := broadcast(context.Background(), []string{"synthetic", doc.Budget.Signer}); err != nil || out != "synthetic-output" || reads != 1 {
		t.Fatal("callback failed", err)
	}
	for _, bad := range []string{"", "SYNTHETIC_PRIVATE\n", "SYNTHETIC_PRIVATE\r", "SYNTHETIC_PRIVATE\x00", strings.Repeat("s", arcadeFreePlayPasswordMax+1)} {
		value = bad
		if secret, err := password(context.Background()); secret != "" || err != errArcadeFreePlaySecret {
			t.Fatal("invalid secret leaked", err)
		}
	}
	value, present = "SYNTHETIC_PRIVATE_PASSWORD", false
	if secret, err := password(context.Background()); secret != "" || err != errArcadeFreePlaySecret {
		t.Fatal("missing secret accepted", err)
	}
	// Cancellation during lookup must not release a just-read secret.
	ctx, cancelDuring := context.WithCancel(context.Background())
	deps.LookupEnv = func(string) (string, bool) { cancelDuring(); return "SYNTHETIC_PRIVATE_PASSWORD", true }
	if _, _, err = loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, deps); err != nil {
		t.Fatal(err)
	}
	if secret, err := password(ctx); secret != "" || err != errArcadeFreePlaySecret {
		t.Fatal("cancelled lookup released secret", err)
	}
	deps.BroadcastFactory = func(string, string, func(context.Context) (string, error)) (arcade.FreePlayBroadcastFunc, error) {
		return nil, errors.New("SYNTHETIC_PRIVATE factory path")
	}
	if cfg, broadcast, err = loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, deps); cfg != nil || broadcast != nil || err != errArcadeFreePlayConfig {
		t.Fatal("factory error escaped", err)
	}
	// A huge exact integer must not silently round through float64 before validation.
	doc.Publish = false
	doc.GnokeyBinary, doc.KeyringHome = nil, nil
	doc.Cost.GasWanted = 9007199254740993
	cfg, _, err = loadArcadeFreePlayConfig("/synthetic/config.json", doc.Cost.Target.ChainID, arcadeFreePlayConfigIO{Open: freePlayConfigReaderForTest(freePlayConfigRawForTest(t, doc))})
	if err != nil || cfg.Cost.GasWanted != 9007199254740993 {
		t.Fatal("integer precision changed", err)
	}
}

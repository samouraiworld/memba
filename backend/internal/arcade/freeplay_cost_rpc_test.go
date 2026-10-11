package arcade

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func priceEnvelope(value any) map[string]any {
	raw, _ := json.Marshal(value)
	return map[string]any{"jsonrpc": "2.0", "result": map[string]any{"response": map[string]any{"ResponseBase": map[string]any{"Error": nil, "Data": base64.StdEncoding.EncodeToString(raw)}, "Height": "0"}}}
}
func priceStatus(target FreePlayTarget, now time.Time) map[string]any {
	return map[string]any{"result": map[string]any{"node_info": map[string]any{"network": target.ChainID}, "sync_info": map[string]any{"latest_block_height": "123", "latest_block_time": now.Add(-time.Second).Format(time.RFC3339Nano), "catching_up": false}}}
}
func TestFreePlayPricesRPCFreshAndUncached(t *testing.T) {
	_, _, _, now := freeCostFixture(t)
	target := FreePlayTarget{"test-chain", FreePlayRealm}
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Cache-Control") != "no-cache" {
			t.Error("price read can use cache")
		}
		var value any
		switch {
		case r.URL.Path == "/status":
			value = priceStatus(target, now)
		case r.URL.Query().Get("path") == `"auth/gasprice"`:
			value = priceEnvelope(map[string]string{"gas": "10", "price": "3ugnot"})
		case r.URL.Query().Get("path") == `"params/vm:p:storage_price"`:
			value = priceEnvelope("4ugnot")
		default:
			t.Errorf("unexpected read %s", r.URL)
			http.Error(w, "unexpected", 400)
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	}))
	defer server.Close()
	source, err := NewFreePlayRPCPrices(server.URL, target, server.Client(), time.Minute, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		prices, err := source.ReadFreePlayPrices(context.Background(), target)
		if err != nil || prices.Height != 123 || prices.Target != target || prices.ObservedAt != now || prices.StoragePriceUgnot != 4 || prices.GasPrice != (GasPrice{10, 3}) {
			t.Fatalf("prices=%+v err=%v", prices, err)
		}
	}
	if requests.Load() != 8 {
		t.Fatalf("cached prices or missing chain checks: %d", requests.Load())
	}
}
func TestFreePlayPricesRPCRejectsUnavailableState(t *testing.T) {
	_, _, _, now := freeCostFixture(t)
	target := FreePlayTarget{"test-chain", FreePlayRealm}
	for _, name := range []string{"wrong chain", "stale node", "syncing", "bad height", "rpc error", "query error", "bad base64", "other denom", "zero price", "oversized", "trailing JSON"} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				status := priceStatus(target, now)
				root := status["result"].(map[string]any)
				sync := root["sync_info"].(map[string]any)
				switch name {
				case "wrong chain":
					root["node_info"].(map[string]any)["network"] = "other-chain"
				case "stale node":
					sync["latest_block_time"] = now.Add(-time.Hour).Format(time.RFC3339)
				case "syncing":
					sync["catching_up"] = true
				case "bad height":
					sync["latest_block_height"] = "0"
				}
				var value any = status
				if r.URL.Path != "/status" {
					value = priceEnvelope(map[string]string{"gas": "10", "price": "3ugnot"})
					if r.URL.Query().Get("path") == `"params/vm:p:storage_price"` {
						value = priceEnvelope("4ugnot")
						if name == "other denom" {
							value = priceEnvelope("4atom")
						}
						if name == "zero price" {
							value = priceEnvelope("0ugnot")
						}
					}
					if name == "query error" {
						value = map[string]any{"result": map[string]any{"response": map[string]any{"ResponseBase": map[string]any{"Error": "unavailable", "Data": ""}}}}
					}
					if name == "bad base64" {
						value = map[string]any{"result": map[string]any{"response": map[string]any{"ResponseBase": map[string]any{"Error": nil, "Data": "%%%"}}}}
					}
				}
				if name == "rpc error" {
					value = map[string]any{"error": map[string]any{"code": -1}}
				}
				if name == "oversized" {
					_, _ = w.Write([]byte(strings.Repeat("x", (64<<10)+1)))
					return
				}
				_ = json.NewEncoder(w).Encode(value)
				if name == "trailing JSON" {
					_, _ = w.Write([]byte("{}"))
				}
			}))
			defer server.Close()
			source, err := NewFreePlayRPCPrices(server.URL, target, server.Client(), time.Minute, func() time.Time { return now })
			if err != nil {
				t.Fatal(err)
			}
			if _, err = source.ReadFreePlayPrices(context.Background(), target); err == nil {
				t.Fatal("unavailable state accepted")
			}
		})
	}
}
func TestFreePlayPricesRPCDoesNotRedirectOrReadWrongTarget(t *testing.T) {
	_, _, _, now := freeCostFixture(t)
	target := FreePlayTarget{"test-chain", FreePlayRealm}
	var destinationReads, sourceReads atomic.Int64
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		destinationReads.Add(1)
		_ = json.NewEncoder(w).Encode(priceStatus(target, now))
	}))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sourceReads.Add(1)
		http.Redirect(w, r, destination.URL, http.StatusFound)
	}))
	defer server.Close()
	source, err := NewFreePlayRPCPrices(server.URL, target, server.Client(), time.Minute, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.ReadFreePlayPrices(context.Background(), FreePlayTarget{"other-chain", FreePlayRealm}); err == nil || sourceReads.Load() != 0 {
		t.Fatal("wrong target read RPC")
	}
	if _, err = source.ReadFreePlayPrices(context.Background(), target); err == nil || destinationReads.Load() != 0 {
		t.Fatal("followed redirect")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = source.ReadFreePlayPrices(ctx, target); err == nil {
		t.Fatal("cancelled price query accepted")
	}
}

type freePriceTransportFunc func(*http.Request) (*http.Response, error)

func (f freePriceTransportFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestFreePlayPricesRPCRequiresHTTPSOutsideLiteralLoopback(t *testing.T) {
	target := FreePlayTarget{"test-chain", FreePlayRealm}
	var reads atomic.Int64
	client := &http.Client{Transport: freePriceTransportFunc(func(*http.Request) (*http.Response, error) {
		reads.Add(1)
		return nil, ErrFreePlayPrices
	})}
	for _, origin := range []string{"http://backend.example", "http://192.168.1.10", "http://0.0.0.0", "http://localhost.example", "http://sub.localhost", "http://localhost.", "http://127.0.0.1.example", "http://localhost@backend.example", "http://[::2]", "http://[::ffff:127.0.0.1]", "http://127.1", "http://2130706433", "http://0x7f000001"} {
		if _, err := NewFreePlayRPCPrices(origin, target, client, time.Minute, nil); err == nil {
			t.Errorf("accepted remote/ambiguous HTTP origin %s", origin)
		}
	}
	for _, origin := range []string{"https://backend.example", "http://localhost:8080", "http://127.0.0.1:8080/", "http://[::1]:8080"} {
		if _, err := NewFreePlayRPCPrices(origin, target, client, time.Minute, nil); err != nil {
			t.Errorf("explicit allowed origin %s: %v", origin, err)
		}
	}
	if reads.Load() != 0 {
		t.Fatalf("constructor performed %d RPC reads", reads.Load())
	}
}

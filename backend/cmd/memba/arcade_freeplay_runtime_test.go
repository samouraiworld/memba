package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/cors"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/service"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type arcadeRuntimeTransportFunc func(*http.Request) (*http.Response, error)

func (f arcadeRuntimeTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestArcadeFreePlayRuntimeNilDormant(t *testing.T) {
	var reads atomic.Int64
	runtime, err := newArcadeFreePlayRuntime(context.Background(), nil, arcadeFreePlayDependencies{HTTP: &http.Client{Transport: arcadeRuntimeTransportFunc(func(*http.Request) (*http.Response, error) { reads.Add(1); return nil, errors.New("unexpected RPC") })}, Broadcast: func(context.Context, []string) (string, error) { t.Error("unexpected signer"); return "", nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.stop()
	w := httptest.NewRecorder()
	runtime.wrap(runtime.handler).ServeHTTP(w, httptest.NewRequest("GET", arcade.FreePlayPrefix+"boards/block-party", nil))
	if w.Code != 404 || reads.Load() != 0 || runtime.child != nil || runtime.limiter != nil || runtime.publisher != nil || runtime.store != nil || runtime.cost != nil {
		t.Fatal("nil config initialized v2")
	}
	runtime.stop()
	if err = runtime.drain(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestArcadeFreePlayRuntimeForcedShutdownDrains(t *testing.T) {
	runtime, err := newArcadeFreePlayRuntime(context.Background(), nil, arcadeFreePlayDependencies{})
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	finished := make(chan struct{})
	server := httptest.NewServer(runtime.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; close(finished) })))
	defer server.Close()
	defer unblock()
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		response, _ := server.Client().Get(server.URL + "/api/non-arcade")
		if response != nil {
			_ = response.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("non-Arcade handler did not start")
	}
	result := make(chan error, 1)
	go func() { result <- shutdownArcadeHTTP(server.Config, runtime, nil, 100*time.Millisecond) }()
	// The request deliberately ignores cancellation until forced server.Close ends
	// its connection. Shutdown must then wait for the handler, not just the socket.
	select {
	case <-clientDone:
	case <-time.After(time.Second):
		unblock()
		t.Fatal("forced HTTP close did not happen")
	}
	select {
	case err := <-result:
		unblock()
		t.Fatalf("returned before handler drain: %v", err)
	default:
	}
	unblock()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("drain did not finish")
	}
	select {
	case <-finished:
	default:
		t.Fatal("handler still active")
	}
	w := httptest.NewRecorder()
	runtime.wrap(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("admitted after stop") })).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Fatal("shutdown admission gate missing")
	}
}
func TestArcadeFreePlayRuntimeRealAuthAndSharedComposition(t *testing.T) {
	raw, err := os.ReadFile("../../internal/arcade/testdata/freeplay/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Runs []struct {
			Target arcade.FreePlayTarget
			Player string
			Input  arcade.FreePlayInput
			Score  int64
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	v := fixture.Runs[0]
	v.Input.ClaimedScore = &v.Score
	database, err := db.Open(t.TempDir() + "/runs.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err = db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	seed := bytes.Repeat([]byte{0x11}, ed25519.SeedSize) // Test-only signing key; never an operator secret.
	t.Setenv("ED25519_SEED", hex.EncodeToString(seed))
	t.Setenv("GNO_CHAIN_ID", v.Target.ChainID)
	t.Setenv("MEMBA_ACCEPTED_CHAIN_IDS", v.Target.ChainID+",other-chain")
	auth, err := service.NewMultisigService(database)
	if err != nil {
		t.Fatal(err)
	}
	cfg := arcadeFreePlayConfig{Cost: arcade.FreePlayCostSettings{Target: v.Target, GasWanted: 101, StorageBytes: 7, FeeMarginNumerator: 3, FeeMarginDenominator: 2, MaxFeeUgnot: 100, MaxDepositUgnot: 100, MaxPriceAge: time.Minute, QuoteLifetime: time.Minute}, Budget: arcade.FreePlayBudgetSettings{Signer: v.Player, MaxAttempts: 2, MaxFeeUgnot: 200, MaxDepositUgnot: 200}, RPCURL: "https://rpc.example", RPCBlockAge: time.Minute, RPCTimeout: time.Second, PublishInterval: time.Hour, Limits: arcadeFreePlayLimits{100, 100, 32, time.Minute}, Node: arcade.Config{NodeBin: "unused-test-node", Timeout: time.Second, Concurrency: 1, MaxOutputBytes: 65536}}
	parent, err := arcade.NewRunner(cfg.Node)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = parent.Close() }()
	var reads atomic.Int64
	cfg.Publish = true
	deps := arcadeFreePlayDependencies{Broadcast: func(context.Context, []string) (string, error) {
		t.Error("automatic broadcast before scheduled work")
		return "", errors.New("unexpected broadcast")
	}, Database: database, Auth: auth, Parent: parent, HTTP: &http.Client{Transport: arcadeRuntimeTransportFunc(func(*http.Request) (*http.Response, error) { reads.Add(1); return nil, errors.New("offline") })}}
	runtime, err := newArcadeFreePlayRuntime(context.Background(), &cfg, deps)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { runtime.stop(); _ = runtime.drain(context.Background()); _ = runtime.child.Close() }()
	if reads.Load() != 0 || runtime.publisher == nil || runtime.cost == nil || runtime.spending == nil || runtime.chain == nil || runtime.child == nil {
		t.Fatal("construction did I/O or omitted dependencies")
	}
	if runtime.publisher.Store != runtime.store || runtime.publisher.Chain != runtime.chain || runtime.publisher.Spending != runtime.spending || runtime.publisher.Signer != cfg.Budget.Signer {
		t.Fatal("publisher dependencies diverged from the HTTP/cost composition")
	}
	// A real service validates a real server signature and rejects expiry/chain.
	token := func(chain string, expiry time.Time, corrupt bool) string {
		tok := &membav1.Token{Nonce: strings.Repeat("a", 64), UserAddress: v.Player, ChainId: chain, Expiration: expiry.UTC().Format(time.RFC3339)}
		data, err := proto.Marshal(tok)
		if err != nil {
			t.Fatal(err)
		}
		signature := ed25519.Sign(ed25519.NewKeyFromSeed(seed), data)
		if corrupt {
			signature[0] ^= 1
		}
		tok.ServerSignature = base64.StdEncoding.EncodeToString(signature)
		return protojson.Format(tok)
	}
	payload, _ := json.Marshal(v.Input)
	call := func(bearer string) int {
		r := httptest.NewRequest("POST", arcade.FreePlayPrefix+"verify", bytes.NewReader(payload))
		r.Header.Set("Authorization", "Bearer "+bearer)
		w := httptest.NewRecorder()
		runtime.wrap(runtime.handler).ServeHTTP(w, r)
		return w.Code
	}
	if got := call(token(v.Target.ChainID, time.Now().Add(time.Hour), false)); got != 200 {
		t.Fatalf("real auth verify=%d", got)
	}
	if got := call(token("other-chain", time.Now().Add(time.Hour), false)); got != 403 {
		t.Fatalf("wrong scope=%d", got)
	}
	if got := call(token(v.Target.ChainID, time.Now().Add(-time.Hour), false)); got != 401 {
		t.Fatalf("expired=%d", got)
	}
	if got := call(token(v.Target.ChainID, time.Now().Add(time.Hour), true)); got != 401 {
		t.Fatalf("invalid signature=%d", got)
	}
	if reads.Load() != 0 {
		t.Fatal("BP verification read RPC")
	}
}

func TestArcadeFreePlayRuntimeHTTPPassthrough(t *testing.T) {
	runtime, err := newArcadeFreePlayRuntime(context.Background(), nil, arcadeFreePlayDependencies{})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.stop()
	var writer http.ResponseWriter
	mux := http.NewServeMux()
	mux.HandleFunc("/api/non-arcade", func(w http.ResponseWriter, r *http.Request) {
		if w != writer {
			t.Error("ResponseWriter identity changed")
		}
		if _, ok := w.(http.Flusher); !ok {
			t.Error("Flusher interface hidden")
		}
		if r.Header.Get("Authorization") != "Bearer passthrough" {
			t.Error("auth header changed")
		}
		w.Header().Set("X-Test", "unchanged")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("unchanged body"))
	})
	plain := cors.New(corsOptions("https://client.example")).Handler(mux)
	for _, method := range []string{"POST", "OPTIONS"} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, "/api/non-arcade", nil)
			request.Header.Set("Origin", "https://client.example")
			request.Header.Set("Authorization", "Bearer passthrough")
			if method == "OPTIONS" {
				request.Header.Set("Access-Control-Request-Method", "POST")
				// Browsers send lowercase names in this preflight header.
				request.Header.Set("Access-Control-Request-Headers", "authorization")
			}
			before, after := httptest.NewRecorder(), httptest.NewRecorder()
			writer = before
			plain.ServeHTTP(before, request)
			writer = after
			runtime.wrap(plain).ServeHTTP(after, request)
			if before.Code != after.Code || before.Body.String() != after.Body.String() || !reflect.DeepEqual(before.Header(), after.Header()) {
				t.Fatalf("wrapper changed response: before=%v after=%v", before, after)
			}
			if after.Header().Get("Access-Control-Allow-Origin") != "https://client.example" {
				t.Fatal("CORS not exercised")
			}
		})
	}
}

func TestArcadeFreePlayRuntimeDrainFailureKeepsBundle(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TMPDIR", root)
	parent, err := arcade.NewRunner(arcade.Config{NodeBin: "unused-test-node"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = parent.Close() }()
	bundles, err := filepath.Glob(filepath.Join(root, "memba-arcade-worker-*", "verify-worker.cjs"))
	if err != nil || len(bundles) != 1 {
		t.Fatalf("bundle fixture: %v %v", bundles, err)
	}
	runtime, err := newArcadeFreePlayRuntime(context.Background(), nil, arcadeFreePlayDependencies{})
	if err != nil {
		t.Fatal(err)
	}
	runtime.background.Add(1)
	server := httptest.NewServer(runtime.wrap(http.NotFoundHandler()))
	defer server.Close()
	err = shutdownArcadeHTTP(server.Config, runtime, parent, 20*time.Millisecond)
	runtime.background.Done()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("undrained work accepted: %v", err)
	}
	if _, err = os.Stat(bundles[0]); err != nil {
		t.Fatalf("bundle removed before drain: %v", err)
	}
	if err = runtime.drain(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestArcadeFreePlayRuntimePublicationCycle(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		t.Run(fmt.Sprintf("ambiguous=%t", ambiguous), func(t *testing.T) {
			raw, err := os.ReadFile("../../internal/arcade/testdata/freeplay/vectors.json")
			if err != nil {
				t.Fatal(err)
			}
			var fixture struct {
				Runs []struct {
					Target arcade.FreePlayTarget
					Player string
					Input  arcade.FreePlayInput
					Score  int64
				}
			}
			if err = json.Unmarshal(raw, &fixture); err != nil {
				t.Fatal(err)
			}
			v := fixture.Runs[0]
			v.Input.ClaimedScore = &v.Score
			expected, err := arcade.VerifyFreePlayRun(context.Background(), v.Target, v.Player, v.Input)
			if err != nil {
				t.Fatal(err)
			}
			database, err := db.Open(t.TempDir() + "/publication.sqlite")
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = database.Close() }()
			if err = db.Migrate(database); err != nil {
				t.Fatal(err)
			}
			seed := bytes.Repeat([]byte{0x22}, ed25519.SeedSize) // Public deterministic test key only.
			t.Setenv("ED25519_SEED", hex.EncodeToString(seed))
			t.Setenv("GNO_CHAIN_ID", v.Target.ChainID)
			t.Setenv("MEMBA_ACCEPTED_CHAIN_IDS", v.Target.ChainID)
			auth, err := service.NewMultisigService(database)
			if err != nil {
				t.Fatal(err)
			}
			token := &membav1.Token{Nonce: strings.Repeat("a", 64), UserAddress: v.Player, ChainId: v.Target.ChainID, Expiration: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
			unsigned, err := proto.Marshal(token)
			if err != nil {
				t.Fatal(err)
			}
			token.ServerSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(ed25519.NewKeyFromSeed(seed), unsigned))
			bearer := protojson.Format(token)

			config := map[string]any{"schemaVersion": 2, "chainId": v.Target.ChainID, "realm": v.Target.Realm, "mode": "free", "paused": false, "maxScore": arcade.FreePlayMaxScore, "maxSimVersion": int64(2147483647), "maxPageSize": 100}
			entryRaw, _ := json.Marshal(expected.Entry)
			var entry map[string]any
			if err = json.Unmarshal(entryRaw, &entry); err != nil {
				t.Fatal(err)
			}
			for key, value := range map[string]any{"schemaVersion": 2, "chainId": v.Target.ChainID, "realm": v.Target.Realm, "mode": "free", "height": 42, "attester": v.Player} {
				entry[key] = value
			}
			var found atomic.Bool
			var rpcCalls, broadcasts atomic.Int64
			queryResult := func(raw []byte) any {
				return map[string]any{"response": map[string]any{"ResponseBase": map[string]any{"Error": nil, "Data": base64.StdEncoding.EncodeToString(raw)}, "Height": "0"}}
			}
			rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				rpcCalls.Add(1)
				status := map[string]any{"node_info": map[string]any{"network": v.Target.ChainID}, "sync_info": map[string]any{"latest_block_height": "100", "latest_block_time": time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano), "catching_up": false}}
				var result any
				if r.Method == "GET" {
					switch {
					case r.URL.Path == "/status":
						result = status
					case r.URL.Query().Get("path") == `"auth/gasprice"`:
						result = queryResult([]byte(`{"gas":"10","price":"3ugnot"}`))
					case r.URL.Query().Get("path") == `"params/vm:p:storage_price"`:
						result = queryResult([]byte(`"4ugnot"`))
					default:
						t.Errorf("unexpected price request %s", r.URL)
						http.Error(w, "unexpected", 400)
						return
					}
				} else {
					var request struct {
						Method string
						Params struct{ Path, Data string }
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
						http.Error(w, "bad request", 400)
						return
					}
					if request.Method == "status" {
						result = status
					} else {
						decoded, err := base64.StdEncoding.DecodeString(request.Params.Data)
						if err != nil || request.Method != "abci_query" || request.Params.Path != "vm/qeval" {
							t.Error("unexpected RPC method")
							http.Error(w, "unexpected", 400)
							return
						}
						var value any
						var amino string
						switch string(decoded) {
						case v.Target.Realm + ".GetConfigJSON()":
							value = config
						case v.Target.Realm + ".GetRunJSON(" + strconv.Quote(expected.Entry.RunID) + ")":
							if found.Load() {
								value = entry
							}
						case v.Target.Realm + ".IsAttester(" + strconv.Quote(v.Player) + ")":
							amino = "(true bool)"
						default:
							t.Errorf("unexpected qeval %s", decoded)
							http.Error(w, "unexpected", 400)
							return
						}
						if amino == "" {
							encoded, _ := json.Marshal(value)
							amino = "(" + strconv.Quote(string(encoded)) + " string)"
						}
						result = queryResult([]byte(amino))
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
			}))
			defer rpc.Close()
			cfg := arcadeFreePlayConfig{Cost: arcade.FreePlayCostSettings{Target: v.Target, GasWanted: 101, StorageBytes: 7, FeeMarginNumerator: 3, FeeMarginDenominator: 2, MaxFeeUgnot: 100, MaxDepositUgnot: 100, MaxPriceAge: time.Minute, QuoteLifetime: 5 * time.Minute}, Budget: arcade.FreePlayBudgetSettings{Signer: v.Player, MaxAttempts: 2, MaxFeeUgnot: 200, MaxDepositUgnot: 200}, RPCURL: rpc.URL, RPCBlockAge: time.Minute, RPCTimeout: time.Second, PublishInterval: time.Hour, Publish: true, Limits: arcadeFreePlayLimits{100, 100, 32, time.Minute}, Node: arcade.Config{NodeBin: "unused-test-node", Timeout: time.Second, Concurrency: 1, MaxOutputBytes: 65536}}
			parent, err := arcade.NewRunner(cfg.Node)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = parent.Close() }()
			checkSpending := func(want int) {
				t.Helper()
				var count, fee, deposit int
				if err := database.QueryRow(`SELECT count(*),coalesce(sum(fee_ugnot),0),coalesce(sum(deposit_ugnot),0) FROM arcade_freeplay_spending_v2`).Scan(&count, &fee, &deposit); err != nil {
					t.Fatal(err)
				}
				if count != want || fee != 46*want || deposit != 28*want {
					t.Fatalf("journal count/fee/deposit=%d/%d/%d want %d reservations", count, fee, deposit, want)
				}
				if err := database.QueryRow(`SELECT coalesce(sum(attempts),0),coalesce(sum(fee_ugnot),0),coalesce(sum(deposit_ugnot),0) FROM arcade_freeplay_budget_v2`).Scan(&count, &fee, &deposit); err != nil {
					t.Fatal(err)
				}
				if count != want || fee != 46*want || deposit != 28*want {
					t.Fatalf("budget count/fee/deposit=%d/%d/%d", count, fee, deposit)
				}
			}
			broadcast := func(ctx context.Context, argv []string) (string, error) {
				if err := ctx.Err(); err != nil {
					t.Fatal(err)
				}
				checkSpending(1) // Durable journal and counters must precede external I/O.
				flags := map[string]string{}
				for i := 0; i+1 < len(argv); i++ {
					flags[argv[i]] = argv[i+1]
				}
				for key, want := range map[string]string{"-gas-fee": "46ugnot", "-gas-wanted": "101", "-max-deposit": "28ugnot", "-chainid": v.Target.ChainID, "-pkgpath": v.Target.Realm, "-remote": rpc.URL} {
					if flags[key] != want {
						t.Errorf("%s=%s want %s", key, flags[key], want)
					}
				}
				if argv[len(argv)-1] != v.Player {
					t.Error("different signer")
				}
				var intent string
				if err := database.QueryRow(`SELECT tx_hash FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, expected.Entry.RunID).Scan(&intent); err != nil || intent != "unknown" {
					t.Fatalf("missing durable broadcast intent: %q %v", intent, err)
				}
				broadcasts.Add(1)
				if ambiguous {
					return "", errors.New("fake connection lost after send")
				}
				found.Store(true)
				return "TX HASH: " + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, 32)) + "\n", nil
			}
			runtime, err := newArcadeFreePlayRuntime(context.Background(), &cfg, arcadeFreePlayDependencies{Database: database, Auth: auth, Parent: parent, HTTP: rpc.Client(), Broadcast: broadcast})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { runtime.stop(); _ = runtime.drain(context.Background()); _ = runtime.child.Close() }()
			var offset atomic.Int64
			// Use a value copy: do not mutate the publisher read by the owned ticker.
			publisher := *runtime.publisher
			publisher.Now = func() time.Time { return time.Now().Add(time.Duration(offset.Load()) * time.Second) }
			call := func(method, path string, body any, want int, out any) {
				t.Helper()
				encoded, err := json.Marshal(body)
				if err != nil {
					t.Fatal(err)
				}
				r := httptest.NewRequest(method, arcade.FreePlayPrefix+path, bytes.NewReader(encoded))
				r.Header.Set("Authorization", "Bearer "+bearer)
				w := httptest.NewRecorder()
				runtime.wrap(runtime.handler).ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
				}
				if out != nil {
					if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
						t.Fatal(err)
					}
				}
			}
			var verified arcade.FreePlayRun
			call("POST", "verify", v.Input, 200, &verified)
			if verified.Entry != expected.Entry || verified.PayloadHash != expected.PayloadHash || rpcCalls.Load() != 0 {
				t.Fatal("verification commitments or RPC isolation changed")
			}
			var quote arcade.FreePlayQuote
			path := "runs/" + verified.Entry.RunID
			call("POST", path+"/quote", struct{}{}, 200, &quote)
			if quote.MaxFeeUgnot != 46 || quote.MaxDepositUgnot != 28 || quote.PayloadHash != verified.PayloadHash {
				t.Fatalf("quote=%+v", quote)
			}
			checkSpending(0)
			if broadcasts.Load() != 0 {
				t.Fatal("broadcast before consent")
			}
			consent := map[string]string{"payloadHash": quote.PayloadHash, "quoteId": quote.ID, "nonce": quote.Nonce}
			var queued arcade.FreePlayRun
			call("POST", path+"/publish", consent, 202, &queued)
			call("POST", path+"/publish", consent, 202, nil)
			if queued.Status != "queued" || broadcasts.Load() != 0 {
				t.Fatal("queue did not wait for worker")
			}
			checkSpending(0)
			worked, err := publisher.PublishOne(context.Background())
			if !worked || (err != nil) != ambiguous {
				t.Fatalf("first publish worked=%t err=%v", worked, err)
			}
			checkSpending(1)
			if ambiguous {
				var pending arcade.FreePlayRun
				call("GET", path, nil, 200, &pending)
				if pending.Status != "submitted" || pending.Receipt != nil || pending.CanReauthorize {
					t.Fatalf("ambiguity lost: %+v", pending)
				}
				offset.Store(120)
				worked, err = publisher.PublishOne(context.Background())
				if !worked || err == nil {
					t.Fatalf("absent ambiguous readback: %t %v", worked, err)
				}
				checkSpending(1)
				if broadcasts.Load() != 1 {
					t.Fatal("ambiguous send automatically repeated")
				}
				found.Store(true)
				offset.Store(240)
				if worked, err = publisher.PublishOne(context.Background()); !worked || err != nil {
					t.Fatalf("reconciliation: %t %v", worked, err)
				}
			}
			var confirmed arcade.FreePlayRun
			call("GET", path, nil, 200, &confirmed)
			if confirmed.Status != "confirmed" || confirmed.Receipt == nil || confirmed.Receipt.Entry != expected.Entry || confirmed.Receipt.Target != v.Target || confirmed.Receipt.Height != 42 || confirmed.Receipt.TxHash != "" {
				t.Fatalf("readback mismatch: %+v", confirmed)
			}
			checkSpending(1)
			if broadcasts.Load() != 1 {
				t.Fatal("duplicate broadcast")
			}
		})
	}
}

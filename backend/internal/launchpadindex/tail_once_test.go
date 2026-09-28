package launchpadindex

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
)

type proofFunc func(context.Context, Scope, *PinnedRPCSource) error

func (f proofFunc) VerifyPublication(ctx context.Context, scope Scope, source *PinnedRPCSource) error {
	return f(ctx, scope, source)
}

func acceptTestProof(_ context.Context, _ Scope, _ *PinnedRPCSource) error { return nil }

type rpcFixtureServer struct {
	mu       sync.Mutex
	latest   int64
	chain    string
	catching bool
	blocks   map[int64][]byte
	results  map[int64][]byte
	failPath string
	blockN   map[int64]int
	onBlock  func(int64, int) []byte
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func newRPCFixtureServer(t *testing.T) (*rpcFixtureServer, *http.Client) {
	t.Helper()
	fixture := &rpcFixtureServer{
		latest: 104, chain: "test-13", blocks: map[int64][]byte{},
		results: map[int64][]byte{}, blockN: map[int64]int{},
	}
	for _, item := range []struct {
		height       int64
		hash, parent byte
	}{
		{100, 1, 9}, {101, 2, 1}, {102, 3, 2}, {103, 4, 3},
	} {
		fixture.blocks[item.height] = rpcBlockBody(t, item.height, item.hash, item.parent)
		fixture.results[item.height] = blockBody(t, strconv.FormatInt(item.height, 10), blockTx(nil))
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		if fixture.failPath == r.URL.Path {
			http.Error(w, "offline", http.StatusServiceUnavailable)
			return
		}
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write(rpcStatusBody(fixture.chain, fixture.latest, fixture.catching))
		case "/block", "/block_results":
			height, err := strconv.ParseInt(r.URL.Query().Get("height"), 10, 64)
			if err != nil {
				http.Error(w, "bad height", http.StatusBadRequest)
				return
			}
			var body []byte
			if r.URL.Path == "/block" {
				fixture.blockN[height]++
				body = fixture.blocks[height]
				if fixture.onBlock != nil {
					if override := fixture.onBlock(height, fixture.blockN[height]); override != nil {
						body = override
					}
				}
			} else {
				body = fixture.results[height]
			}
			if body == nil {
				http.Error(w, "missing", http.StatusNotFound)
				return
			}
			_, _ = w.Write(body)
		default:
			http.NotFound(w, r)
		}
	})
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Result(), nil
	})}
	return fixture, client
}

func rpcStatusBody(chain string, latest int64, catching bool) []byte {
	body, _ := json.Marshal(map[string]any{"result": map[string]any{
		"node_info": map[string]any{"network": chain},
		"sync_info": map[string]any{"latest_block_height": strconv.FormatInt(latest, 10), "catching_up": catching},
	}})
	return body
}

func rpcBlockBody(t *testing.T, height int64, hash, parent byte) []byte {
	return rpcBlockBodyWithTxCount(t, height, hash, parent, 1)
}

func rpcBlockBodyWithTxCount(t *testing.T, height int64, hash, parent byte, numTxs int64) []byte {
	t.Helper()
	return changedBlockFixture(t, func(body map[string]any) {
		header := metaHeader(body)
		header["chain_id"] = "test-13"
		header["height"] = strconv.FormatInt(height, 10)
		header["num_txs"] = strconv.FormatInt(numTxs, 10)
		header["last_block_id"].(map[string]any)["hash"] = encodedHash(parent)
		full := fullHeader(body)
		full["chain_id"] = "test-13"
		full["height"] = strconv.FormatInt(height, 10)
		full["num_txs"] = strconv.FormatInt(numTxs, 10)
		full["last_block_id"].(map[string]any)["hash"] = encodedHash(parent)
		blockResult(body)["block_meta"].(map[string]any)["block_id"].(map[string]any)["hash"] =
			encodedHash(hash)
	})
}

func encodedHash(first byte) string {
	hash := [32]byte{first}
	return base64.StdEncoding.EncodeToString(hash[:])
}

func testTailer(t *testing.T, client *http.Client, verifier PublicationVerifier, confirmations int64) (*Tailer, *Store) {
	t.Helper()
	store, _ := testStore(t)
	source, err := NewPinnedRPCSource("https://rpc.example", client)
	if err != nil {
		t.Fatal(err)
	}
	if verifier == nil {
		verifier = proofFunc(acceptTestProof)
	}
	tailer, err := NewTailer(store, source, verifier, confirmations)
	if err != nil {
		t.Fatal(err)
	}
	return tailer, store
}

func TestTailerConfirmationBoundaryAndEmptyBlocks(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	fixture.latest = 101
	if progressed, err := tailer.Step(ctx); err != nil || progressed {
		t.Fatalf("unconfirmed activation processed: %v %v", progressed, err)
	}
	fixture.latest = 102
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("confirmed activation not processed: %v %v", progressed, err)
	}
	fixture.latest = 103
	fixture.blocks[102] = rpcBlockBodyWithTxCount(t, 102, 3, 2, 0)
	fixture.results[102] = blockBody(t, "102")
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("zero-transaction block not processed: %v %v", progressed, err)
	}
	if progressed, err := tailer.Step(ctx); err != nil || progressed {
		t.Fatalf("advanced beyond safe tip: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 102 || cursor.Hash != ([32]byte{3}) {
		t.Fatalf("wrong empty-block cursor: %+v %v", cursor, err)
	}
}

func TestTailerRejectsWrongNodeAndOutagesWithoutProgress(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	for _, path := range []string{"/status", "/block", "/block_results"} {
		fixture.failPath = path
		if progressed, err := tailer.Step(ctx); err == nil || progressed {
			t.Fatalf("%s outage advanced journal: %v %v", path, progressed, err)
		}
	}
	fixture.failPath = ""
	fixture.chain = "gnoland-1"
	if progressed, err := tailer.Step(ctx); !errors.Is(err, ErrInvalidNodeStatus) || progressed {
		t.Fatalf("wrong chain advanced journal: %v %v", progressed, err)
	}
	fixture.chain = "test-13"
	fixture.catching = true
	if progressed, err := tailer.Step(ctx); !errors.Is(err, ErrInvalidNodeStatus) || progressed {
		t.Fatalf("catching-up node advanced journal: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 100 {
		t.Fatalf("failed reads changed cursor: %+v %v", cursor, err)
	}
}

func TestTailerRequiresPublicationProofAndStableBlock(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	reject := proofFunc(func(context.Context, Scope, *PinnedRPCSource) error { return errors.New("receipt mismatch") })
	tailer, store := testTailer(t, client, reject, 1)
	if progressed, err := tailer.Step(context.Background()); err == nil || progressed {
		t.Fatalf("missing proof advanced journal: %v %v", progressed, err)
	}
	tailer.verifier = proofFunc(acceptTestProof)
	raceBlock := rpcBlockBody(t, 101, 9, 1)
	fixture.onBlock = func(height int64, n int) []byte {
		if height == 101 && n == 4 {
			return raceBlock
		}
		return nil
	}
	if progressed, err := tailer.Step(context.Background()); err == nil || progressed {
		t.Fatalf("block hash race advanced journal: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(context.Background())
	if err != nil || cursor.Height != 100 {
		t.Fatalf("proof/race changed cursor: %+v %v", cursor, err)
	}
}

func TestTailerRequiresSuccessfulActivationInCurrentResults(t *testing.T) {
	for _, tc := range []struct {
		name string
		txs  []any
	}{
		{"missing index zero", nil},
		{"failed index zero", []any{blockTx(map[string]any{"Code": 1})}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture, client := newRPCFixtureServer(t)
			tailer, store := testTailer(t, client, nil, 1)
			fixture.results[101] = blockBody(t, "101", tc.txs...)
			if progressed, err := tailer.Step(context.Background()); err == nil || progressed {
				t.Fatalf("bad activation result advanced cursor: %v %v", progressed, err)
			}
			cursor, err := store.Cursor(context.Background())
			if err != nil || cursor.Height != 100 {
				t.Fatalf("bad activation changed cursor: %+v %v", cursor, err)
			}
		})
	}
}

func TestTailerRejectsTruncatedDeliveries(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("activation: %v %v", progressed, err)
	}
	fixture.blocks[102] = rpcBlockBodyWithTxCount(t, 102, 3, 2, 2)
	fixture.results[102] = blockBody(t, "102", blockTx(nil))
	if progressed, err := tailer.Step(ctx); err == nil || progressed {
		t.Fatalf("truncated deliveries advanced cursor: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 101 {
		t.Fatalf("truncated results changed cursor: %+v %v", cursor, err)
	}
}

func TestTailerReorgRollbackAndAnchorStop(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	fixture.results[102] = blockBody(t, "102", blockTx(nil, blockEvent(TokenRealmPath, TokenCreatedType, validEvent(t, "T1"))))
	for i := 0; i < 3; i++ {
		if progressed, err := tailer.Step(ctx); err != nil || !progressed {
			t.Fatalf("initial block %d: %v %v", i, progressed, err)
		}
	}
	fixture.blocks[102] = rpcBlockBody(t, 102, 5, 2)
	fixture.blocks[103] = rpcBlockBody(t, 103, 6, 5)
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("fork rollback: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 101 {
		t.Fatalf("fork rollback cursor: %+v %v", cursor, err)
	}
	var stale int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM launchpad_creation_events WHERE scope_key = ?`, store.key).
		Scan(&stale); err != nil || stale != 0 {
		t.Fatalf("fork kept stale creation: %d %v", stale, err)
	}
	if progressed, err := tailer.Step(ctx); err != nil || !progressed {
		t.Fatalf("fork replacement: %v %v", progressed, err)
	}
	fixture.blocks[101] = rpcBlockBody(t, 101, 9, 1)
	if progressed, err := tailer.Step(ctx); !errors.Is(err, ErrReorgBelowAnchor) || progressed {
		t.Fatalf("activation fork adopted: %v %v", progressed, err)
	}
}

func TestTailerHaltsIfAnchorChangesDuringAncestorScan(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if progressed, err := tailer.Step(ctx); err != nil || !progressed {
			t.Fatalf("initial block %d: %v %v", i, progressed, err)
		}
	}
	fixture.blocks[103] = rpcBlockBody(t, 103, 6, 3)
	changedAnchor := rpcBlockBody(t, 101, 9, 1)
	anchorReads := 0
	fixture.onBlock = func(height int64, _ int) []byte {
		if height == 101 {
			anchorReads++
			if anchorReads >= 2 {
				return changedAnchor
			}
		}
		return nil
	}
	if progressed, err := tailer.Step(ctx); !errors.Is(err, ErrReorgBelowAnchor) || progressed {
		t.Fatalf("moving anchor permitted rollback: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 103 || cursor.Hash != ([32]byte{4}) {
		t.Fatalf("moving anchor changed cursor: %+v %v", cursor, err)
	}
}

func TestTailerSkipsMalformedPreActivationGeneration(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	ctx := context.Background()
	database, err := db.Open(filepath.Join(t.TempDir(), "memba.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := MigrateStore(ctx, database); err != nil {
		t.Fatal(err)
	}
	scope := testScope("test-13", "publication-a")
	scope.ActivationTxIndex = 1
	store, err := OpenStore(ctx, database, scope)
	if err != nil {
		t.Fatal(err)
	}
	source, err := NewPinnedRPCSource("https://rpc.example", client)
	if err != nil {
		t.Fatal(err)
	}
	tailer, err := NewTailer(store, source, proofFunc(acceptTestProof), 1)
	if err != nil {
		t.Fatal(err)
	}
	bad := validEvent(t, "T1")
	bad[6] = Attribute{Key: "id", Value: "T1"}
	valid := validEvent(t, "T2")
	valid[2].Value = registeredLedgerID("T2", 2)
	fixture.results[101] = blockBody(t, "101",
		blockTx(nil, blockEvent(TokenRealmPath, TokenCreatedType, bad)),
		blockTx(nil, blockEvent(TokenRealmPath, TokenCreatedType, valid)))
	fixture.blocks[101] = rpcBlockBodyWithTxCount(t, 101, 2, 1, 2)
	if progressed, err := tailer.Step(context.Background()); err != nil || !progressed {
		t.Fatalf("pre-activation event blocked new generation: %v %v", progressed, err)
	}
	var tokenID string
	if err := store.db.QueryRowContext(context.Background(), `SELECT token_id FROM launchpad_creation_events WHERE scope_key = ?`, store.key).
		Scan(&tokenID); err != nil || tokenID != "T2" {
		t.Fatalf("wrong activation creation: %q %v", tokenID, err)
	}
	fixture.results[102] = blockBody(t, "102", blockTx(nil, blockEvent(TokenRealmPath, TokenCreatedType, bad)))
	if progressed, err := tailer.Step(ctx); err == nil || progressed {
		t.Fatalf("malformed post-activation event advanced cursor: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 101 {
		t.Fatalf("malformed result changed cursor: %+v %v", cursor, err)
	}
}

func TestTailerConcurrentStepsAndSourceBehind(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	var group sync.WaitGroup
	var failures = make(chan error, 3)
	for range 3 {
		group.Go(func() {
			_, err := tailer.Step(context.Background())
			failures <- err
		})
	}
	group.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatalf("concurrent step: %v", err)
		}
	}
	cursor, err := store.Cursor(context.Background())
	if err != nil || cursor.Height != 103 {
		t.Fatalf("concurrent steps skipped/duplicated blocks: %+v %v", cursor, err)
	}
	fixture.mu.Lock()
	fixture.latest = 103
	fixture.mu.Unlock()
	if progressed, err := tailer.Step(context.Background()); !errors.Is(err, ErrSourceBehind) || progressed {
		t.Fatalf("behind source rewound cursor: %v %v", progressed, err)
	}
	fixture.mu.Lock()
	fixture.latest = 100
	fixture.mu.Unlock()
	if progressed, err := tailer.Step(context.Background()); !errors.Is(err, ErrSourceBehind) || progressed {
		t.Fatalf("far-behind source silently waited: %v %v", progressed, err)
	}
}

func TestTailerBoundsDeepReorgScan(t *testing.T) {
	fixture, client := newRPCFixtureServer(t)
	tailer, store := testTailer(t, client, nil, 1)
	ctx := context.Background()
	for height := int64(101); height <= 170; height++ {
		hash := byte(height - 99)
		parent := hash - 1
		header := testHeader(height, hash, parent)
		header.NumTxs = 1
		if err := store.AppendBlock(ctx, header, nil); err != nil {
			t.Fatal(err)
		}
		if height > 101 {
			fixture.blocks[height] = rpcBlockBody(t, height, hash+100, parent+100)
		}
	}
	fixture.latest = 171
	if progressed, err := tailer.Step(ctx); !errors.Is(err, ErrReorgScanLimit) || progressed {
		t.Fatalf("unbounded/deep fork recovery: %v %v", progressed, err)
	}
	cursor, err := store.Cursor(ctx)
	if err != nil || cursor.Height != 170 {
		t.Fatalf("deep fork changed cursor: %+v %v", cursor, err)
	}
}

func TestPinnedSourceRejectsRedirectAndBadConfig(t *testing.T) {
	if _, err := NewPinnedRPCSource("https://rpc.example/path", nil); !errors.Is(err, ErrInvalidRPCSource) {
		t.Fatalf("accepted mutable base path: %v", err)
	}
	client := &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://other.example/status"}}, Body: http.NoBody}, nil
	})}
	source, err := NewPinnedRPCSource("https://rpc.example", client)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.status(context.Background()); err == nil {
		t.Fatal("redirect escaped pinned endpoint")
	}
	store, _ := testStore(t)
	if _, err := NewTailer(store, source, nil, 1); !errors.Is(err, ErrTailerConfig) {
		t.Fatalf("accepted missing publication verifier: %v", err)
	}
	if _, err := NewTailer(store, source, proofFunc(acceptTestProof), 0); !errors.Is(err, ErrTailerConfig) {
		t.Fatalf("accepted missing confirmation depth: %v", err)
	}
}

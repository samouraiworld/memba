package arcade

import (
	"context"
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
	"sync/atomic"
	"testing"
	"time"
)

type freePlayCostCheckFunc func(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error

func (f freePlayCostCheckFunc) ValidateBroadcast(ctx context.Context, target FreePlayTarget, e FreePlayEntry, q FreePlayQuote, gas int64) error {
	return f(ctx, target, e, q, gas)
}

type fpRPCFixture struct {
	t          *testing.T
	run        FreePlayRun
	config     map[string]any
	entry      map[string]any
	board      any
	chain      string
	height     string
	missing    bool
	authorized bool
	failQuery  bool
	calls      atomic.Int64
	server     *httptest.Server
}

func newFPRPCFixture(t *testing.T) *fpRPCFixture {
	t.Helper()
	run := freeFixture(t)
	f := &fpRPCFixture{t: t, run: run, chain: run.Target.ChainID, height: "100", authorized: true}
	f.config = map[string]any{"schemaVersion": 2, "chainId": run.Target.ChainID, "realm": run.Target.Realm, "mode": "free", "paused": false, "maxScore": FreePlayMaxScore, "maxSimVersion": int64(2147483647), "maxPageSize": 100}
	b, _ := json.Marshal(run.Entry)
	_ = json.Unmarshal(b, &f.entry)
	for k, v := range map[string]any{"schemaVersion": 2, "chainId": run.Target.ChainID, "realm": run.Target.Realm, "mode": "free", "height": 42, "attester": run.Entry.Player} {
		f.entry[k] = v
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}
func (f *fpRPCFixture) serve(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	var request struct {
		Method string `json:"method"`
		Params struct {
			Path string `json:"path"`
			Data string `json:"data"`
		} `json:"params"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	var result any
	if request.Method == "status" {
		result = map[string]any{"node_info": map[string]any{"network": f.chain}, "sync_info": map[string]any{"latest_block_height": f.height, "catching_up": false}}
	} else {
		decoded, err := base64.StdEncoding.DecodeString(request.Params.Data)
		if err != nil || request.Method != "abci_query" || request.Params.Path != "vm/qeval" {
			http.Error(w, "bad request", 400)
			return
		}
		expr := string(decoded)
		var raw string
		switch {
		case expr == f.run.Target.Realm+".GetConfigJSON()":
			b, _ := json.Marshal(f.config)
			raw = "(" + strconv.Quote(string(b)) + " string)"
		case expr == f.run.Target.Realm+".IsAttester("+strconv.Quote(f.run.Entry.Player)+")":
			raw = fmt.Sprintf("(%t bool)", f.authorized)
		case expr == f.run.Target.Realm+".GetRunJSON("+strconv.Quote(f.run.Entry.RunID)+")":
			b, _ := json.Marshal(f.entry)
			if f.missing {
				b = []byte("null")
			}
			raw = "(" + strconv.Quote(string(b)) + " string)"
		case strings.HasPrefix(expr, f.run.Target.Realm+".GetBoardJSON("):
			board := f.board
			if board == nil {
				board = []any{f.entry}
			}
			b, _ := json.Marshal(board)
			raw = "(" + strconv.Quote(string(b)) + " string)"
		default:
			http.Error(w, "unexpected expression", 400)
			return
		}
		base := map[string]any{"Data": base64.StdEncoding.EncodeToString([]byte(raw)), "Error": nil}
		if f.failQuery {
			base["Error"] = map[string]any{"message": "realm failed"}
		}
		result = map[string]any{"response": map[string]any{"ResponseBase": base, "Height": "0"}}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
}
func (f *fpRPCFixture) chainClient(t *testing.T, broadcast FreePlayBroadcastFunc, cost FreePlayBroadcastCostCheck) *FreePlayRPCChain {
	t.Helper()
	c, err := NewFreePlayRPCChain(FreePlayChainConfig{Enabled: true, Target: f.run.Target, RPCURL: f.server.URL, Signer: f.run.Entry.Player, GasWanted: 30_000_000, MaxFeeUgnot: 30000, MaxDepositUgnot: 2000000, Timeout: time.Second}, f.server.Client(), broadcast, cost)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func fpAllowCost(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error {
	return nil
}
func fpNoBroadcast(context.Context, []string) (string, error) {
	return "", errors.New("must not broadcast")
}
func (f *fpRPCFixture) quote() FreePlayQuote {
	return FreePlayQuote{ID: strings.Repeat("a", 64), RunID: f.run.Entry.RunID, PayloadHash: f.run.Entry.PayloadHash(f.run.Target), Nonce: strings.Repeat("b", 64), ExpiresAt: time.Now().Add(time.Minute).Unix(), Payer: "studio", MaxFeeUgnot: 20000, MaxDepositUgnot: 1000000}
}

func TestFreePlayRPCReadbackAndBoard(t *testing.T) {
	f := newFPRPCFixture(t)
	c := f.chainClient(t, fpNoBroadcast, freePlayCostCheckFunc(fpAllowCost))
	ctx := context.Background()
	r, found, err := c.Lookup(ctx, f.run.Target, f.run.Entry.RunID)
	if err != nil || !found || r.Entry != f.run.Entry || r.Target != f.run.Target || r.Height != 42 || r.TxHash != "" {
		t.Fatalf("receipt: %+v %v %v", r, found, err)
	}
	rows, err := c.ReadBoard(ctx, f.run.Target, f.run.Entry.Game, f.run.Entry.Rules, f.run.Entry.SimVersion, 0, 20)
	if err != nil || len(rows) != 1 || rows[0] != r {
		t.Fatalf("board: %+v %v", rows, err)
	}
	f.missing = true
	_, found, err = c.Lookup(ctx, f.run.Target, f.run.Entry.RunID)
	if err != nil || found {
		t.Fatal("only explicit null should mean absent", err)
	}
	f.board = []any{}
	rows, err = c.ReadBoard(ctx, f.run.Target, f.run.Entry.Game, f.run.Entry.Rules, f.run.Entry.SimVersion, 0, 20)
	if err != nil || rows == nil || len(rows) != 0 {
		t.Fatal("empty board", err)
	}
	f.failQuery = true
	_, found, err = c.Lookup(ctx, f.run.Target, f.run.Entry.RunID)
	if err == nil || found {
		t.Fatal("query error must not be absence")
	}
}

func TestFreePlayRPCRejectsUntrustedContextAndReceipts(t *testing.T) {
	for _, name := range []string{"chain", "realm", "schema", "mode", "missing-pause", "missing-score", "null-score", "height", "attester", "run", "extra", "duplicate-player", "wrong-board", "null-board"} {
		t.Run(name, func(t *testing.T) {
			f := newFPRPCFixture(t)
			c := f.chainClient(t, fpNoBroadcast, freePlayCostCheckFunc(fpAllowCost))
			switch name {
			case "chain":
				f.chain = "wrong"
			case "realm":
				f.config["realm"] = "gno.land/r/wrong"
			case "schema":
				f.config["schemaVersion"] = 1
			case "mode":
				f.config["mode"] = "daily"
			case "missing-pause":
				delete(f.config, "paused")
			case "missing-score":
				delete(f.entry, "score")
			case "null-score":
				f.entry["score"] = nil
			case "height":
				f.entry["height"] = 101
			case "attester":
				f.entry["attester"] = "invalid"
			case "run":
				f.entry["runID"] = strings.Repeat("e", 64)
			case "extra":
				f.entry["unexpected"] = true
			case "duplicate-player":
				f.board = []any{f.entry, f.entry}
			case "wrong-board":
				f.entry["game"] = "space-invaders"
			case "null-board":
				f.board = json.RawMessage("null")
			}
			if name == "duplicate-player" || name == "wrong-board" || name == "null-board" {
				_, err := c.ReadBoard(context.Background(), f.run.Target, f.run.Entry.Game, f.run.Entry.Rules, f.run.Entry.SimVersion, 0, 20)
				if err == nil {
					t.Fatal("accepted invalid board")
				}
			} else {
				_, found, err := c.Lookup(context.Background(), f.run.Target, f.run.Entry.RunID)
				if err == nil || found {
					t.Fatal("accepted invalid receipt")
				}
			}
		})
	}
}

func TestFreePlayRPCValidatesBeforeIO(t *testing.T) {
	f := newFPRPCFixture(t)
	c := f.chainClient(t, fpNoBroadcast, freePlayCostCheckFunc(fpAllowCost))
	_, _, _ = c.Lookup(context.Background(), FreePlayTarget{"wrong", FreePlayRealm}, f.run.Entry.RunID)
	_, _, _ = c.Lookup(context.Background(), f.run.Target, "bad-id")
	for _, page := range [][2]int{{-1, 20}, {100001, 20}, {0, 0}, {0, 101}} {
		if _, err := c.ReadBoard(context.Background(), f.run.Target, f.run.Entry.Game, f.run.Entry.Rules, 1, page[0], page[1]); err == nil {
			t.Fatal("invalid page accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, _ = c.Lookup(ctx, f.run.Target, f.run.Entry.RunID)
	if f.calls.Load() != 0 {
		t.Fatal("invalid input reached RPC")
	}
}

func TestFreePlayRPCAnchorExactArgsAndCanonicalHash(t *testing.T) {
	f := newFPRPCFixture(t)
	var got []string
	count := 0
	hashBytes := bytes32(7)
	c := f.chainClient(t, func(_ context.Context, args []string) (string, error) {
		count++
		got = append([]string(nil), args...)
		return "OK!\nTX HASH:    " + base64.StdEncoding.EncodeToString(hashBytes) + "\n", nil
	}, freePlayCostCheckFunc(fpAllowCost))
	q := f.quote()
	hash, err := c.Anchor(context.Background(), f.run.Target, f.run.Entry, q)
	if err != nil || hash != hex.EncodeToString(hashBytes) || count != 1 {
		t.Fatalf("hash=%q err=%v calls=%d", hash, err, count)
	}
	e := f.run.Entry
	want := []string{"maketx", "call", "-pkgpath", f.run.Target.Realm, "-func", "AnchorScore"}
	for _, v := range []string{e.Game, e.Player, e.Rules, strconv.FormatInt(e.SimVersion, 10), e.RunID, e.Seed, strconv.FormatInt(e.Score, 10), e.StateHash, e.ReplayHash} {
		want = append(want, "-args", v)
	}
	want = append(want, "-gas-fee", "20000ugnot", "-gas-wanted", "30000000", "-max-deposit", "1000000ugnot", "-chainid", f.run.Target.ChainID, "-remote", f.server.URL, "-insecure-password-stdin", "-broadcast", e.Player)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected argv: %v", got)
	}
}
func bytes32(v byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = v
	}
	return b
}

func TestFreePlayRPCAnchorRefusesBeforeBroadcast(t *testing.T) {
	for _, name := range []string{"disabled", "paused", "attester", "target", "expired", "payload", "payer", "fee", "deposit", "cost-denied", "cost-expires", "cost-cancels"} {
		t.Run(name, func(t *testing.T) {
			f := newFPRPCFixture(t)
			count := 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c := f.chainClient(t, func(context.Context, []string) (string, error) { count++; return "", nil }, freePlayCostCheckFunc(fpAllowCost))
			q := f.quote()
			target := f.run.Target
			switch name {
			case "disabled":
				c.cfg.Enabled = false
			case "paused":
				f.config["paused"] = true
			case "attester":
				f.authorized = false
			case "target":
				target.ChainID = "wrong"
			case "expired":
				q.ExpiresAt = time.Now().Unix()
			case "payload":
				q.PayloadHash = strings.Repeat("f", 64)
			case "payer":
				q.Payer = "player"
			case "fee":
				q.MaxFeeUgnot = c.cfg.MaxFeeUgnot + 1
			case "deposit":
				q.MaxDepositUgnot = c.cfg.MaxDepositUgnot + 1
			case "cost-denied":
				c.cost = freePlayCostCheckFunc(func(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error {
					return errors.New("denied")
				})
			case "cost-expires":
				c.cost = freePlayCostCheckFunc(func(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error {
					c.now = func() time.Time { return time.Unix(q.ExpiresAt, 0) }
					return nil
				})
			case "cost-cancels":
				c.cost = freePlayCostCheckFunc(func(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error { cancel(); return nil })
			}
			if _, err := c.Anchor(ctx, target, f.run.Entry, q); err == nil || count != 0 {
				t.Fatalf("accepted %s / calls %d", name, count)
			}
		})
	}
}

func TestFreePlayRPCAmbiguousOutputNeverRetries(t *testing.T) {
	for _, out := range []string{"random stdout", "TX HASH: nope", "TX HASH: " + base64.StdEncoding.EncodeToString(bytes32(1)) + "\nTX HASH: " + base64.StdEncoding.EncodeToString(bytes32(2))} {
		f := newFPRPCFixture(t)
		calls := 0
		c := f.chainClient(t, func(context.Context, []string) (string, error) { calls++; return out, nil }, freePlayCostCheckFunc(fpAllowCost))
		if h, err := c.Anchor(context.Background(), f.run.Target, f.run.Entry, f.quote()); err == nil || h != "" || calls != 1 {
			t.Fatal("ambiguous output accepted/retried")
		}
	}
	f := newFPRPCFixture(t)
	calls := 0
	c := f.chainClient(t, func(context.Context, []string) (string, error) {
		calls++
		return "TX HASH: " + base64.StdEncoding.EncodeToString(bytes32(1)), errors.New("uncertain")
	}, freePlayCostCheckFunc(fpAllowCost))
	if h, err := c.Anchor(context.Background(), f.run.Target, f.run.Entry, f.quote()); err == nil || h != "" || calls != 1 {
		t.Fatal("broadcast error retried/confirmed")
	}
}

func TestFreePlayRPCBoundsResponseRedirectAndDeadline(t *testing.T) {
	for _, kind := range []string{"oversize", "redirect", "deadline", "trailing", "rpc-error"} {
		t.Run(kind, func(t *testing.T) {
			f := newFPRPCFixture(t)
			secondHits := atomic.Int64{}
			second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { secondHits.Add(1); w.WriteHeader(500) }))
			defer second.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch kind {
				case "oversize":
					_, _ = w.Write([]byte(strings.Repeat("x", freePlayRPCBodyLimit+1)))
				case "redirect":
					http.Redirect(w, r, second.URL, 302)
				case "deadline":
					<-r.Context().Done()
				case "trailing":
					_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}} {}`))
				case "rpc-error":
					_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"message":"no"}}`))
				}
			}))
			defer server.Close()
			c := f.chainClient(t, fpNoBroadcast, freePlayCostCheckFunc(fpAllowCost))
			c.cfg.RPCURL = server.URL
			c.cfg.Timeout = 30 * time.Millisecond
			_, _, err := c.Lookup(context.Background(), f.run.Target, f.run.Entry.RunID)
			if err == nil || secondHits.Load() != 0 {
				t.Fatal("unbounded or redirected request accepted")
			}
		})
	}
}

func TestFreePlayGnokeyIsDormantBoundedAndRedacts(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "ran")
	binary := filepath.Join(dir, "fake-gnokey")
	// Disposable local fixture only; never a keyring, RPC, wallet or real signer.
	script := "#!/bin/sh\nprintf ran > '" + marker + "'\nprintf 'TX HASH: " + base64.StdEncoding.EncodeToString(bytes32(9)) + "\\n'\n"
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	calls := 0
	b, err := NewFreePlayGnokeyBroadcast(binary, dir, func(context.Context) (string, error) { calls++; return "TEST_SECRET", nil })
	if err != nil || calls != 0 {
		t.Fatal("constructor did I/O")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = b(ctx, []string{"--never"}); err == nil {
		t.Fatal("cancelled invocation")
	}
	if _, err = os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancelled process ran")
	}
	out, err := b(context.Background(), []string{"--fixture"})
	if err != nil {
		t.Fatal(err)
	}
	if h, err := freePlayTxHash(out); err != nil || h != hex.EncodeToString(bytes32(9)) {
		t.Fatal("fixture hash", err)
	}
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nprintf 'TEST_SECRET' >&2\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err = b(context.Background(), nil); err == nil || strings.Contains(err.Error(), "TEST_SECRET") {
		t.Fatal("signer output leaked")
	}
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nexec sleep 5\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err = b(ctx, nil); err == nil || time.Since(start) > time.Second {
		t.Fatal("signer timeout not bounded")
	}
	var cap freePlayCappedOutput
	if _, err = cap.Write([]byte(strings.Repeat("a", 64<<10))); err != nil {
		t.Fatal(err)
	}
	if _, err = cap.Write([]byte("x")); err == nil || !cap.exceeded || cap.Len() != 64<<10 {
		t.Fatal("output cap")
	}
}

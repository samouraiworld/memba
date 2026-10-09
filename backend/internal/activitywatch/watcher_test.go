package activitywatch

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/std"
	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

type fixture struct {
	w            *Watcher
	head         int64
	network      string
	stale        bool
	status       int
	missingID    bool
	resultHeight string
	reorg        int64
	txs          map[int64][][]byte
	failed       bool
	sent         []string
	posts        int
	now          time.Time
	server       *httptest.Server
}

func setup(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{head: 10, network: "gnoland-1", status: 200, txs: map[int64][][]byte{}, now: time.Date(2026, 10, 8, 21, 0, 0, 0, time.UTC)}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	database, err := db.Open(filepath.Join(t.TempDir(), "watch.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err = db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	// Repeat migration to exercise upgrades/restarts by full filename.
	if err = db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	cfg := Config{ChainID: "gnoland-1", RPCURL: DefaultRPC, WebhookURL: "https://discord.com/api/webhooks/123/secret", Realms: []string{"gno.land/r/samcrew/*"}}
	f.w, err = New(database, cfg)
	if err != nil {
		t.Fatal(err)
	}
	f.w.cfg.RPCURL = f.server.URL + "/rpc"
	f.w.cfg.WebhookURL = f.server.URL + "/webhook"
	f.w.now = func() time.Time { return f.now }
	f.w.pause = func(context.Context, time.Duration) error { return nil }
	return f
}

func (f *fixture) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/webhook" {
		f.posts++
		var body struct {
			Content string `json:"content"`
			Allowed struct {
				Parse []string `json:"parse"`
			} `json:"allowed_mentions"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || r.URL.Query().Get("wait") != "true" || body.Allowed.Parse == nil || len(body.Allowed.Parse) != 0 {
			http.Error(w, "unsafe request", 400)
			return
		}
		w.WriteHeader(f.status)
		if f.status == 429 {
			_, _ = w.Write([]byte(`{"retry_after":60}`))
			return
		}
		if f.status == 200 {
			f.sent = append(f.sent, body.Content)
			if f.missingID {
				_, _ = w.Write([]byte(`{}`))
			} else {
				_, _ = w.Write([]byte(`{"id":"123456"}`))
			}
		}
		return
	}
	var req struct {
		Method string            `json:"method"`
		Params map[string]string `json:"params"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "bad JSON", 400)
		return
	}
	h, _ := strconv.ParseInt(req.Params["height"], 10, 64)
	var result any
	switch req.Method {
	case "status":
		now := f.now
		if f.stale {
			now = now.Add(-time.Hour)
		}
		result = map[string]any{"node_info": map[string]any{"network": f.network}, "sync_info": map[string]any{"latest_block_height": strconv.FormatInt(f.head, 10), "latest_block_time": now, "catching_up": false}}
	case "block":
		var b block
		b.BlockMeta.BlockID.Hash = fmt.Sprintf("hash-%d", h)
		if f.reorg == h {
			b.BlockMeta.BlockID.Hash = "changed"
		}
		b.Block.Header.ChainID = f.network
		b.Block.Header.Height = strconv.FormatInt(h, 10)
		b.Block.Header.Time = f.now
		b.Block.Header.LastBlockID.Hash = fmt.Sprintf("hash-%d", h-1)
		b.Block.Data.Txs = f.txs[h]
		b.Block.Header.NumTxs = strconv.Itoa(len(b.Block.Data.Txs))
		result = b
	case "block_results":
		var receipts []map[string]any
		for range f.txs[h] {
			var failure any
			if f.failed {
				failure = map[string]any{"message": "SECRET FAILED ARG"}
			}
			receipts = append(receipts, map[string]any{"ResponseBase": map[string]any{"Error": failure, "Events": []event{{Type: "Voted", PkgPath: "gno.land/r/samcrew/memba_gov"}}}})
		}
		height := strconv.FormatInt(h, 10)
		if f.resultHeight != "" {
			height = f.resultHeight
		}
		result = map[string]any{"height": height, "results": map[string]any{"deliver_tx": receipts}}
	default:
		http.Error(w, "unknown", 400)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"result": result})
}

func call(t *testing.T, path, fn string) []byte {
	t.Helper()
	b, err := amino.Marshal(std.Tx{Msgs: []std.Msg{vm.MsgCall{PkgPath: path, Func: fn, Args: []string{"PRIVATE_POST_BODY"}}}, Memo: "PRIVATE_MEMO"})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func run(t *testing.T, f *fixture) {
	t.Helper()
	if err := f.w.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func cursor(t *testing.T, f *fixture) int64 {
	t.Helper()
	var h int64
	if err := f.w.db.QueryRow(`SELECT height FROM activity_watch_state WHERE chain_id='gnoland-1'`).Scan(&h); err != nil {
		t.Fatal(err)
	}
	return h
}

func TestNewActivityAndRestart(t *testing.T) {
	f := setup(t)
	f.txs[4] = [][]byte{call(t, "gno.land/r/samcrew/memba_feed_v1", "Post")}
	run(t, f)
	if cursor(t, f) != 5 || len(f.sent) != 1 || !strings.Contains(f.sent[0], "enabled") {
		t.Fatal("must start at confirmed head with one notice, no replay")
	}
	f.txs[6] = [][]byte{call(t, "gno.land/r/samcrew/connect4", "Play")}
	f.head = 11
	run(t, f)
	if cursor(t, f) != 6 || len(f.sent) != 2 || !strings.Contains(f.sent[1], "Play") || !strings.Contains(f.sent[1], "Voted") {
		t.Fatalf("missing activity: %v", f.sent)
	}
	if strings.Contains(f.sent[1], "PRIVATE") {
		t.Fatal("private content escaped")
	}
	// New process state, same persistent database; no duplicate startup/activity.
	f.w = &Watcher{cfg: f.w.cfg, db: f.w.db, client: f.w.client, now: f.w.now, pause: f.w.pause}
	run(t, f)
	if len(f.sent) != 2 {
		t.Fatal("duplicate after restart")
	}
}

func TestOutagePersistsAndResumesWithoutSkipping(t *testing.T) {
	f := setup(t)
	run(t, f)
	f.txs[6] = [][]byte{call(t, "gno.land/r/samcrew/launchpad/sales/v1", "Buy")}
	f.head = 12
	f.status = 500
	if f.w.cycle(context.Background()) == nil {
		t.Fatal("expected failed delivery")
	}
	if cursor(t, f) != 6 {
		t.Fatal("must stop scanning behind pending delivery")
	}
	var count int
	if err := f.w.db.QueryRow(`SELECT COUNT(*) FROM activity_watch_outbox`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	f.w = &Watcher{cfg: f.w.cfg, db: f.w.db, client: f.w.client, now: f.w.now, pause: f.w.pause}
	f.status = 200
	run(t, f)
	if cursor(t, f) != 7 || len(f.sent) != 2 {
		t.Fatal("did not resume persisted delivery and cursor")
	}
	run(t, f)
	if len(f.sent) != 2 {
		t.Fatal("repeated acknowledged delivery")
	}
}

func TestRateLimitAndMissingReceiptKeepMessage(t *testing.T) {
	f := setup(t)
	f.status = 429
	if f.w.cycle(context.Background()) == nil {
		t.Fatal("expected rate limit")
	}
	_ = f.w.cycle(context.Background())
	if f.posts != 1 {
		t.Fatal("retried before Retry-After")
	}
	f.now = f.now.Add(time.Minute)
	f.status = 200
	f.missingID = true
	if f.w.cycle(context.Background()) == nil {
		t.Fatal("accepted unconfirmed delivery")
	}
	f.missingID = false
	run(t, f)
	var n int
	if err := f.w.db.QueryRow(`SELECT COUNT(*) FROM activity_watch_outbox`).Scan(&n); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}

func TestWrongChainStaleNodeAndChangedBlockHalt(t *testing.T) {
	for _, mode := range []string{"chain", "stale", "reorg", "receipts"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			run(t, f)
			f.txs[6] = [][]byte{call(t, "gno.land/r/samcrew/connect4", "Play")}
			f.head = 11
			switch mode {
			case "chain":
				f.network = "onyx-1"
			case "stale":
				f.stale = true
			case "reorg":
				f.reorg = 5
			case "receipts":
				f.resultHeight = "999"
			}
			if f.w.cycle(context.Background()) == nil {
				t.Fatal("must reject inconsistent chain data")
			}
			if cursor(t, f) != 5 || len(f.sent) != 1 {
				t.Fatal("advanced cursor or sent unsafe activity")
			}
		})
	}
}

func TestFailedCallDoesNotReportRolledBackEvents(t *testing.T) {
	f := setup(t)
	run(t, f)
	f.failed = true
	f.txs[6] = [][]byte{call(t, "gno.land/r/samcrew/connect4", "Play")}
	f.head = 11
	run(t, f)
	got := f.sent[1]
	if !strings.Contains(got, "FAILED (realm changes reverted; fees may apply)") || strings.Contains(got, "Voted") || strings.Contains(got, "SECRET") {
		t.Fatal(got)
	}
}

func TestDailyHeartbeatAndNoRestartSpam(t *testing.T) {
	f := setup(t)
	run(t, f)
	f.now = f.now.Add(24 * time.Hour)
	f.head = 11
	run(t, f)
	if len(f.sent) != 2 || !strings.Contains(f.sent[1], "heartbeat") {
		t.Fatal(f.sent)
	}
	run(t, f)
	if len(f.sent) != 2 {
		t.Fatal("heartbeat repeated")
	}
}

func TestScopeAndSafeMessages(t *testing.T) {
	f := setup(t)
	for _, p := range []string{"gno.land/r/samcrew_evil/game", "gno.land/r/other/dao", "gno.land/p/samcrew/math"} {
		if f.w.cfg.watches(p) {
			t.Fatal("matched unrelated path", p)
		}
	}
	f.w.cfg.Realms = append(f.w.cfg.Realms, "gno.land/r/alice/dao")
	if !f.w.cfg.watches("gno.land/r/samcrew/new/game") || !f.w.cfg.watches("gno.land/r/alice/dao") || f.w.cfg.watches("gno.land/r/alice/dao2") {
		t.Fatal("selector boundary error")
	}
	r := receipt{}
	r.ResponseBase = &struct {
		Error  json.RawMessage `json:"Error"`
		Events []event         `json:"Events"`
	}{Error: json.RawMessage(`null`)}
	for i := 0; i < 40; i++ {
		r.ResponseBase.Events = append(r.ResponseBase.Events, event{Type: fmt.Sprintf("Action%d@everyone`\n", i), PkgPath: "gno.land/r/samcrew/test"})
	}
	m, err := f.w.messages(6, call(t, "gno.land/r/samcrew/test", "Call"), r)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) < 2 {
		t.Fatal("large activity was not split")
	}
	for _, s := range m {
		if len(s) > 1800 || strings.Contains(s, "@") || strings.Contains(s, "PRIVATE") {
			t.Fatal("unsafe or oversized message")
		}
	}
}

func TestInvalidConfigFailsClosed(t *testing.T) {
	c := ConfigFromEnv(func(key string) string {
		switch key {
		case "GNO_CHAIN_ID":
			return "gnoland-1"
		case "LAUNCHPAD_WATCH_WEBHOOK_URL":
			return "https://discord.com/api/webhooks/123/secret"
		}
		return ""
	})
	if c.validate() != nil {
		t.Fatal("valid defaults rejected")
	}
	for _, s := range []string{"*", "gno.land/r/samcrew*", "gno.land/r/samcrew/../other", "gno.land/r/samcrew/**", ""} {
		bad := c
		bad.Realms = []string{s}
		if bad.validate() == nil {
			t.Fatal("accepted", s)
		}
	}
	for _, u := range []string{"", "http://discord.com/api/webhooks/123/secret", "https://evil.test/api/webhooks/123/secret", "https://discord.com@evil.test/api/webhooks/123/secret"} {
		bad := c
		bad.WebhookURL = u
		if bad.validate() == nil {
			t.Fatal("accepted webhook", u)
		}
	}
}

func TestRecordedMainnetEnable(t *testing.T) {
	f := setup(t)
	var b struct {
		Result block `json:"result"`
	}
	var r struct {
		Result results `json:"result"`
	}
	for name, dst := range map[string]any{"mainnet-enable-block.json": &b, "mainnet-enable-results.json": &r} {
		data, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(data, dst); err != nil {
			t.Fatal(err)
		}
	}
	m, err := f.w.messages(658489, b.Result.Block.Data.Txs[0], r.Result.Results.DeliverTx[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 1 || !strings.Contains(m[0], "PackageEnabled") || !strings.Contains(m[0], "gno.land/r/samcrew/connect4") {
		t.Fatal(m)
	}
}

func TestMalformedReceiptAndUndecodableTxDoNotAdvance(t *testing.T) {
	f := setup(t)
	if _, err := f.w.messages(6, call(t, "gno.land/r/samcrew/test", "Post"), receipt{}); err == nil {
		t.Fatal("accepted missing receipt")
	}
	r := receipt{}
	r.ResponseBase = &struct {
		Error  json.RawMessage `json:"Error"`
		Events []event         `json:"Events"`
	}{Error: json.RawMessage(`null`)}
	if _, err := f.w.messages(6, []byte("invalid"), r); err == nil {
		t.Fatal("accepted undecodable transaction")
	}
}

func TestActivityWithoutCustomEventsAndExplicitOtherDAO(t *testing.T) {
	f := setup(t)
	f.w.cfg.Realms = append(f.w.cfg.Realms, "gno.land/r/alice/dao")
	r := receipt{}
	r.ResponseBase = &struct {
		Error  json.RawMessage `json:"Error"`
		Events []event         `json:"Events"`
	}{Error: json.RawMessage(`null`)}
	for _, path := range []string{"gno.land/r/samcrew/connect4", "gno.land/r/alice/dao"} {
		m, err := f.w.messages(6, call(t, path, "Vote"), r)
		if err != nil || len(m) != 1 || !strings.Contains(m[0], "Vote") {
			t.Fatal(m, err)
		}
	}
	m, err := f.w.messages(6, call(t, "gno.land/r/unrelated/dao", "Vote"), r)
	if err != nil || len(m) != 0 {
		t.Fatal(m, err)
	}
}

func TestOutboxFailureDoesNotAdvanceCursor(t *testing.T) {
	f := setup(t)
	run(t, f)
	if _, err := f.w.db.Exec(`CREATE TRIGGER reject_outbox BEFORE INSERT ON activity_watch_outbox BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	f.txs[6] = [][]byte{call(t, "gno.land/r/samcrew/connect4", "Play")}
	f.head = 11
	if f.w.cycle(context.Background()) == nil {
		t.Fatal("expected database failure")
	}
	if cursor(t, f) != 5 || len(f.sent) != 1 {
		t.Fatal("activity lost after queue failure")
	}
	if _, err := f.w.db.Exec(`DROP TRIGGER reject_outbox`); err != nil {
		t.Fatal(err)
	}
	run(t, f)
	if len(f.sent) != 2 || cursor(t, f) != 6 {
		t.Fatal("did not recover transactionally")
	}
}

func TestUnrelatedMainnetBankTransferDoesNotStall(t *testing.T) {
	f := setup(t)
	b, err := os.ReadFile("testdata/mainnet-bank-tx.txt")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	r := receipt{}
	r.ResponseBase = &struct {
		Error  json.RawMessage `json:"Error"`
		Events []event         `json:"Events"`
	}{Error: json.RawMessage(`null`)}
	m, err := f.w.messages(661707, raw, r)
	if err != nil || len(m) != 0 {
		t.Fatal(m, err)
	}
}

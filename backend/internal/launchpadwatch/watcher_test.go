package launchpadwatch

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"log/slog"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	_ "modernc.org/sqlite"
)

// chainStub is a JSON-RPC node with scripted books. Each realm read pops the
// next scripted answer and repeats the last one once the script runs out.
type chainStub struct {
	mu        sync.Mutex
	network   string
	views     []string // SolvencyJSON answers
	salesBank []string // bank balance of the sales realm, e.g. "100ugnot"
	escrow    []string
	offers    []map[string]string // OffersJSON pages by `before`
	mktBank   []string
	// mktBankErr answers the market's bank query with an ABCI error.
	mktBankErr bool
	height     int64
	frozen     bool // the height stops advancing
	catchingUp bool
	offerReads int
}

func pop(s *[]string) string {
	v := (*s)[0]
	if len(*s) > 1 {
		*s = (*s)[1:]
	}
	return v
}

func (c *chainStub) serve(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var req struct {
		Method string `json:"method"`
		Params struct {
			Path string `json:"path"`
			Data string `json:"data"`
		} `json:"params"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Method == "status" {
		if !c.frozen {
			c.height++
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
			"node_info": map[string]any{"network": c.network},
			"sync_info": map[string]any{"latest_block_height": strconv.FormatInt(c.height, 10), "catching_up": c.catchingUp}}})
		return
	}
	data, _ := base64.StdEncoding.DecodeString(req.Params.Data)
	expr := string(data)
	var answer string
	switch {
	case req.Params.Path == "bank/balances/"+realmAddress(salesRealm):
		answer = strconv.Quote(pop(&c.salesBank))
	case req.Params.Path == "bank/balances/"+realmAddress(marketRealm) && c.mktBankErr:
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
			"ResponseBase": map[string]any{"Error": map[string]any{"@type": "/std.InternalError"}, "Data": nil}}}})
		return
	case req.Params.Path == "bank/balances/"+realmAddress(marketRealm):
		answer = strconv.Quote(pop(&c.mktBank))
	case strings.Contains(expr, "SolvencyJSON"):
		answer = fmt.Sprintf("(%s string)", strconv.Quote(pop(&c.views)))
	case strings.Contains(expr, "EscrowOf"):
		answer = fmt.Sprintf("(%s int64)", pop(&c.escrow))
	case strings.Contains(expr, "OffersJSON"):
		c.offerReads++
		before := strings.Split(expr, `"`)[1]
		page := "[]"
		if len(c.offers) > 0 {
			if p, ok := c.offers[0][before]; ok {
				page = p
			}
		}
		answer = fmt.Sprintf("(%s string)", strconv.Quote(page))
	default:
		http.Error(w, "unexpected "+req.Params.Path+" "+expr, http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
		"ResponseBase": map[string]any{"Error": nil, "Data": base64.StdEncoding.EncodeToString([]byte(answer))}}}})
}

func view(balance, fees, escrow, refunds, proceeds string) string {
	owed := new(big.Int)
	for _, s := range []string{fees, escrow, refunds, proceeds} {
		v, _ := new(big.Int).SetString(s, 10)
		owed.Add(owed, v)
	}
	return fmt.Sprintf(`{"schema":"launchpad-sales-solvency-v1","currency":"ugnot","balance":"%s","owed":"%s","fees":"%s","escrow":"%s","refunds":"%s","proceeds":"%s"}`,
		balance, owed, fees, escrow, refunds, proceeds)
}

type pages struct {
	mu   sync.Mutex
	got  []map[string]string
	fail bool
}

func (p *pages) serve(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.fail {
		http.Error(w, "down", http.StatusBadGateway)
		return
	}
	body, _ := io.ReadAll(r.Body)
	var m map[string]string
	_ = json.Unmarshal(body, &m)
	p.got = append(p.got, m)
}

func (p *pages) rules() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []string
	for _, m := range p.got {
		out = append(out, strings.TrimSuffix(strings.Fields(m["content"])[2], ":"))
	}
	return out
}

type harness struct {
	t     *testing.T
	chain *chainStub
	pages *pages
	w     *Watcher
	clock time.Time
}

func newHarness(t *testing.T, chainID string, offset int64) *harness {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	h := &harness{t: t, chain: &chainStub{network: chainID, escrow: []string{"0"}, mktBank: []string{""}, height: 4241}, pages: &pages{}, clock: time.Unix(1_800_000_000, 0)}
	node := httptest.NewServer(http.HandlerFunc(h.chain.serve))
	hook := httptest.NewServer(http.HandlerFunc(h.pages.serve))
	t.Cleanup(node.Close)
	t.Cleanup(hook.Close)
	w, err := New(database, Config{RPCURL: node.URL, ChainID: chainID, WebhookURL: hook.URL, InjectBalanceOffset: offset})
	if err != nil {
		t.Fatal(err)
	}
	w.pause = func(context.Context, time.Duration) error { return nil }
	w.now = func() time.Time { return h.clock }
	h.w = w
	return h
}

// sales scripts the sales leg with one steady state.
func (h *harness) sales(balance, fees, escrow, refunds, proceeds string) {
	h.chain.mu.Lock()
	defer h.chain.mu.Unlock()
	h.chain.views = []string{view(balance, fees, escrow, refunds, proceeds)}
	h.chain.salesBank = []string{balance + "ugnot"}
}

func (h *harness) tick() { h.w.tick(context.Background()) }

func (h *harness) wantRules(want ...string) {
	h.t.Helper()
	if got := h.pages.rules(); strings.Join(got, ",") != strings.Join(want, ",") {
		h.t.Fatalf("pages = %v, want %v", got, want)
	}
}

func TestRealmAddressesMatchTheSpec(t *testing.T) {
	if got := realmAddress(salesRealm); got != "g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53" {
		t.Errorf("sales address %s", got)
	}
	if got := realmAddress(marketRealm); got != "g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3" {
		t.Errorf("market address %s", got)
	}
}

func TestNewRefusesAnInjectionOffOnyx(t *testing.T) {
	if _, err := New(nil, Config{RPCURL: "x", ChainID: "gnoland-1", WebhookURL: "y", InjectBalanceOffset: -1}); err == nil {
		t.Fatal("an offset on gnoland-1 was accepted")
	}
	if _, err := New(nil, Config{RPCURL: "x", ChainID: "gnoland-1"}); err == nil {
		t.Fatal("a watcher with no webhook was accepted")
	}
}

func TestDeficitPagesOnTheSecondStableReading(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("100", "10", "50", "20", "20") // balance = owed: fine
	h.tick()
	h.wantRules()
	h.sales("99", "10", "50", "20", "20") // owed − 1
	h.tick()
	h.wantRules("surplus_fell") // the surplus fell 0 → −1; one deficit reading is not yet a page
	h.tick()
	h.wantRules("surplus_fell", "deficit")
	h.tick()
	h.wantRules("surplus_fell", "deficit") // a held rule pages once
	h.sales("100", "10", "50", "20", "20")
	h.tick()
	h.sales("99", "10", "50", "20", "20")
	h.tick()
	h.tick()
	h.wantRules("surplus_fell", "deficit", "surplus_fell", "deficit") // cleared, then held again
}

func TestSurplusRulesOnBothSidesOfTheBoundary(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("105", "5", "0", "0", "0") // surplus 100
	h.tick()
	h.tick() // equal: fine
	h.wantRules()
	h.sales("106", "5", "0", "0", "0") // one more: logged only
	h.tick()
	h.wantRules()
	h.sales("105", "5", "0", "0", "0") // one less than the stored 101
	h.tick()
	h.wantRules("surplus_fell")
	if p := h.pages.got[0]["content"]; !strings.Contains(p, "previous surplus: 101") || !strings.Contains(p, "surplus fell from 101 to 100") {
		t.Fatalf("page lacks the previous surplus:\n%s", p)
	}
}

func TestAmountsAbove2To53StayExact(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	// 2^53 + 1 is not a float64: a float comparison would call these equal.
	h.sales("9007199254740992", "9007199254740993", "0", "0", "0")
	h.tick()
	h.tick()
	h.wantRules("deficit")
}

func TestAViewThatIsNotTheKnownOnePages(t *testing.T) {
	for name, bad := range map[string]string{
		"malformed": `{"schema":"launchpad-sales-solvency-v1"`,
		"schema":    strings.Replace(view("1", "1", "0", "0", "0"), "solvency-v1", "solvency-v2", 1),
		"currency":  strings.Replace(view("1", "1", "0", "0", "0"), `"currency":"ugnot"`, `"currency":"foo"`, 1),
		"owed sum":  strings.Replace(view("2", "1", "0", "0", "0"), `"owed":"1"`, `"owed":"2"`, 1),
		"float":     strings.Replace(view("1", "1", "0", "0", "0"), `"fees":"1"`, `"fees":1`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "gnoland-1", 0)
			h.chain.views, h.chain.salesBank = []string{bad}, []string{"1ugnot"}
			h.tick()
			h.wantRules("view")
		})
	}
}

func TestUnstableThenStable(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	// a would store a surplus of 10, b of 0: only b is ever read stable.
	a, b := view("100", "90", "0", "0", "0"), view("150", "150", "0", "0", "0")
	// S1 ≠ S2, then a bank balance that disagrees, then a stable reading.
	h.chain.views = []string{a, b, b, b, b}
	h.chain.salesBank = []string{"100ugnot", "1ugnot", "150ugnot"}
	h.tick()
	h.wantRules()
	if st, ok, _ := h.w.stored(salesRealm); !ok || st.surplus.Sign() != 0 {
		t.Fatalf("stored surplus %v %v, want 0", st.surplus, ok)
	}
}

func TestNeverStableWarnsAndNeverPages(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.chain.views = []string{view("100", "100", "0", "0", "0")}
	h.chain.salesBank = []string{"7ugnot"} // the bank never agrees
	for i := 0; i < 10; i++ {
		h.tick()
		h.clock = h.clock.Add(time.Minute)
	}
	h.wantRules()
	if !h.w.warned[salesRealm] {
		t.Fatal("no unreadable warning after 10 minutes")
	}
	if _, ok, _ := h.w.stored(salesRealm); ok {
		t.Fatal("an unstable reading was stored")
	}
}

func TestAnotherChainIsSkipped(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.chain.network = "pearl-1"
	h.sales("0", "100", "0", "0", "0") // a deficit, on the wrong chain
	h.tick()
	h.tick()
	h.wantRules()
	if _, ok, _ := h.w.stored(salesRealm); ok {
		t.Fatal("a reading from another chain was stored")
	}
}

// The rehearsal: a baseline run stores the surplus, then a run with the offset
// pages the fall on its first reading and the deficit on its second, on both legs.
func TestInjectedOffsetPagesOnOnyx(t *testing.T) {
	h := newHarness(t, "onyx-1", 0)
	h.sales("100", "100", "0", "0", "0")
	h.tick()
	h.w.cfg.InjectBalanceOffset = -1
	h.tick()
	h.wantRules("surplus_fell", "surplus_fell")
	h.tick()
	h.wantRules("surplus_fell", "surplus_fell", "deficit", "deficit")
	if !strings.Contains(h.pages.got[0]["text"], "balance offset -1 injected") {
		t.Fatalf("page does not say the offset was injected:\n%s", h.pages.got[0]["text"])
	}
}

func TestAnUndeliveredPageIsRetried(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("0", "1", "0", "0", "0")
	h.pages.fail = true
	h.tick()
	h.tick()
	h.pages.fail = false
	h.tick()
	h.wantRules("deficit")
}

func TestPageNamesEverything(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("0", "1", "0", "0", "0")
	h.tick()
	h.tick()
	p := h.pages.got[0]
	if p["content"] != p["text"] {
		t.Fatal("Discord and Telegram bodies differ")
	}
	for _, want := range []string{"chain gnoland-1", "height 42", salesRealm, `"fees":"1"`, "rpc: http", "config/v1.Pause fairsale"} {
		if !strings.Contains(p["content"], want) {
			t.Errorf("page lacks %q:\n%s", want, p["content"])
		}
	}
}

func TestMarketLeg(t *testing.T) {
	offer := func(id string, price string, currency string) string {
		return fmt.Sprintf(`{"id":"%s","price":%s,"currency":"%s"}`, id, price, currency)
	}
	full := make([]string, offersPage)
	for i := range full {
		full[i] = offer(fmt.Sprintf("O%03d", 100-i), "2", "ugnot")
	}
	lastID := fmt.Sprintf("O%03d", 100-offersPage+1)
	second := "[" + offer("O001", "9007199254740993", "ugnot") + "," + offer("O000", "5", "foo") + "]"
	escrow := new(big.Int).Add(big.NewInt(2*offersPage), big.NewInt(9007199254740993))

	h := newHarness(t, "gnoland-1", 0)
	h.chain.views, h.chain.salesBank = []string{view("0", "0", "0", "0", "0")}, []string{""}
	h.chain.offers = []map[string]string{{"": "[" + strings.Join(full, ",") + "]", lastID: second}}
	h.chain.escrow = []string{escrow.String()}
	h.chain.mktBank = []string{escrow.String() + "ugnot,3foo"}
	h.tick()
	h.wantRules()

	h.chain.escrow = []string{new(big.Int).Add(escrow, big.NewInt(1)).String()}
	h.tick()
	h.wantRules("view") // the open offers are not the escrow
	if !strings.Contains(h.pages.got[0]["content"], "config/v1.Pause nft_market") {
		t.Fatalf("market page names the wrong lane:\n%s", h.pages.got[0]["content"])
	}
}

func TestMarketReadsTwoEqualPasses(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("0", "0", "0", "0", "0")
	// The first pass sees escrow 5 with no open offer; the books then settle at 0.
	h.chain.escrow = []string{"5", "0"}
	h.tick()
	h.wantRules()
}

func TestAnABCIErrorIsNeverAZeroBalance(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("0", "0", "0", "0", "0")
	h.chain.offers = []map[string]string{{"": `[{"id":"O1","price":5,"currency":"ugnot"}]`}}
	h.chain.escrow = []string{"5"}
	h.chain.mktBankErr = true
	h.tick()
	h.tick()
	h.wantRules()
	if _, ok, _ := h.w.stored(marketRealm); ok {
		t.Fatal("a failed balance query was stored as a reading")
	}
}

func TestAFrozenOrCatchingUpNodeIsUnreadable(t *testing.T) {
	for name, freeze := range map[string]func(*chainStub){
		"frozen":      func(c *chainStub) { c.frozen = true },
		"catching up": func(c *chainStub) { c.catchingUp = true },
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "gnoland-1", 0)
			h.sales("100", "100", "0", "0", "0")
			h.tick()
			h.chain.mu.Lock()
			freeze(h.chain)
			h.chain.mu.Unlock()
			// The node keeps answering the same books: none of it is fresh.
			start := h.clock
			for i := 0; i < 10; i++ {
				h.clock = h.clock.Add(time.Minute)
				h.tick()
			}
			h.wantRules()
			if !h.w.warned[salesRealm] {
				t.Fatal("no unreadable warning")
			}
			// At most the first reading after the freeze is genuine state at that height.
			if v := testutil.ToFloat64(metrics.LaunchpadLastStableReading.WithLabelValues(salesRealm)); v > float64(start.Add(time.Minute).Unix()) {
				t.Fatalf("last stable reading kept moving: %v", v)
			}
		})
	}
}

func TestAFallPagedDuringAnOutageIsSentWhenTheWebhookReturns(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("105", "5", "0", "0", "0")
	h.tick()
	h.sales("104", "5", "0", "0", "0")
	h.pages.fail = true
	h.tick()
	if v := testutil.ToFloat64(metrics.LaunchpadAlert.WithLabelValues(salesRealm, "surplus_fell")); v != 1 {
		t.Fatalf("alert metric %v during the fall", v)
	}
	h.pages.fail = false
	for i := 0; i < 5; i++ {
		h.tick()
	}
	h.wantRules("surplus_fell")
	if p := h.pages.got[0]["content"]; !strings.Contains(p, "surplus fell from 100 to 99") {
		t.Fatalf("retried page:\n%s", p)
	}
	if v := testutil.ToFloat64(metrics.LaunchpadAlert.WithLabelValues(salesRealm, "surplus_fell")); v != 0 {
		t.Fatalf("alert metric %v after the page was delivered", v)
	}
}

func TestTheWebhookSecretNeverReachesLogsOrErrors(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	h := newHarness(t, "gnoland-1", 0)
	h.w.cfg.WebhookURL = "http://127.0.0.1:1/bot123456:SECRETTOKEN/sendMessage?chat_id=42"
	h.sales("0", "1", "0", "0", "0")
	h.tick()
	h.tick()
	err := Notify(h.w.client, h.w.cfg.WebhookURL, "x")
	if err == nil {
		t.Fatal("a closed port accepted the page")
	}
	for _, leak := range []string{"SECRETTOKEN", "chat_id", "sendMessage"} {
		if strings.Contains(logs.String(), leak) || strings.Contains(err.Error(), leak) {
			t.Fatalf("%q leaked:\nlogs: %s\nerror: %v", leak, logs.String(), err)
		}
	}
	if !strings.Contains(err.Error(), "127.0.0.1:1") {
		t.Fatalf("error does not name the host: %v", err)
	}
}

func TestStalenessSeriesExistsFromTheStart(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.chain.network = "pearl-1" // never a stable reading
	metrics.LaunchpadLastStableReading.Reset()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.w.Run(ctx)
	if v := testutil.ToFloat64(metrics.LaunchpadLastStableReading.WithLabelValues(salesRealm)); v != float64(h.clock.Unix()) {
		t.Fatalf("last stable reading gauge %v, want the start time", v)
	}
}

func TestNegativeAmountsAreAViewProblem(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	// owed is still the sum of the liabilities: only the sign is wrong.
	h.sales("0", "-50", "50", "0", "0")
	h.tick()
	h.wantRules("view")

	m := newHarness(t, "gnoland-1", 0)
	m.sales("0", "0", "0", "0", "0")
	m.chain.escrow = []string{"-5"}
	m.tick()
	m.wantRules("view")

	n := newHarness(t, "gnoland-1", 0)
	n.sales("0", "0", "0", "0", "0")
	n.chain.offers = []map[string]string{{"": `[{"id":"O1","price":-5,"currency":"ugnot"}]`}}
	n.tick()
	n.wantRules("view")
}

func TestARepeatedOffersCursorEndsTheRead(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("0", "0", "0", "0", "0")
	full := make([]string, offersPage)
	for i := range full {
		full[i] = `{"id":"O9","price":1,"currency":"ugnot"}`
	}
	page := "[" + strings.Join(full, ",") + "]"
	h.chain.offers = []map[string]string{{"": page, "O9": page}}
	done := make(chan struct{})
	go func() { h.tick(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the offers read never ended")
	}
	if _, ok, _ := h.w.stored(marketRealm); ok {
		t.Fatal("a looping offers read was stored")
	}
	if h.chain.offerReads > 2*offersPage { // the cursor check stops it, long before the page cap
		t.Fatalf("%d offer pages read", h.chain.offerReads)
	}
}

// A restart onto a node behind the last stable reading (older books) reads
// nothing until the node passes that height.
func TestARestartOntoANodeBehindReadsNothing(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("105", "5", "0", "0", "0") // surplus 100
	h.tick()
	h.chain.mu.Lock()
	reached := h.chain.height
	h.chain.height = 100 // a node far behind, serving older books
	h.chain.mu.Unlock()
	h.sales("95", "5", "0", "0", "0") // surplus 90 at that older height
	w, err := New(h.w.db, h.w.cfg)
	if err != nil {
		t.Fatal(err)
	}
	w.pause, w.now = h.w.pause, h.w.now
	h.w = w
	h.tick()
	h.wantRules()
	h.chain.mu.Lock()
	h.chain.height = reached // caught up: its books are news again
	h.chain.mu.Unlock()
	h.tick()
	h.wantRules("surplus_fell")
}

// A fall stays pending until paged, even when later readings refill it.
func TestAFallThatRecoversIsStillPaged(t *testing.T) {
	h := newHarness(t, "gnoland-1", 0)
	h.sales("105", "5", "0", "0", "0") // surplus 100
	h.tick()
	h.pages.fail = true
	h.sales("95", "5", "0", "0", "0") // 90
	h.tick()
	h.sales("97", "5", "0", "0", "0") // 92: the lowest stays 90
	h.tick()
	h.sales("105", "5", "0", "0", "0") // back to 100
	h.tick()
	h.pages.fail = false
	h.tick()
	h.tick()
	h.wantRules("surplus_fell")
	if p := h.pages.got[0]["content"]; !strings.Contains(p, "surplus fell from 100 to 90 (now 100)") {
		t.Fatalf("page:\n%s", p)
	}
}

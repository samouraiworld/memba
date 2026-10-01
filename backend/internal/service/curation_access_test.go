package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cosmos/cosmos-sdk/types/bech32"
)

const curationTestChain = "curation-test-1"

// curationTestAddr returns a valid gno address made of 20 bytes of b.
func curationTestAddr(t *testing.T, b byte) string {
	t.Helper()
	addr, err := bech32.ConvertAndEncode("g", bytes.Repeat([]byte{b}, 20))
	if err != nil {
		t.Fatal(err)
	}
	return addr
}

type curationRole struct{ founder, manager, conflicted bool }

// curationStub is an RPC node of chain network whose latest block is blockAge
// old. abci_query answers AccessJSON from roles (an account with no entry holds
// no role); any other request fails the test.
type curationStub struct {
	*httptest.Server
	mu          sync.Mutex
	network     string
	blockAge    time.Duration
	roles       map[string]curationRole
	raw         *string // when set, the vm/qeval print returned verbatim
	failQuery   bool
	absentRealm bool
	realmAborts bool     // as the realm does for a collection it does not know
	queries     []string // every expression evaluated
}

var curationExprArgs = regexp.MustCompile(`\.AccessJSON\("([^"]*)","([^"]*)"\)$`)

// curationAnswer is the realm's AccessJSON object, as evaluated on chain at the
// block time at.
func curationAnswer(chain string, at time.Time, collection, account string, role curationRole) string {
	return fmt.Sprintf(`{"chainId":%q,"height":"1200","time":"%d","collection":%q,"account":%q,"founder":%t,"manager":%t,"conflicted":%t}`,
		chain, at.Unix(), collection, account, role.founder, role.manager, role.conflicted)
}

// curationPrint is how vm/qeval prints a string result.
func curationPrint(answer string) string { return "(" + strconv.Quote(answer) + " string)" }

func newCurationStub(t *testing.T, network string) *curationStub {
	t.Helper()
	s := &curationStub{network: network, roles: map[string]curationRole{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		var req abciQueryRequest
		_ = json.Unmarshal(body, &req)
		expr, err := base64.StdEncoding.DecodeString(req.Params.Data)
		if err != nil || req.Params.Path != "vm/qeval" {
			t.Errorf("unexpected query path %q (data error %v)", req.Params.Path, err)
		}
		s.queries = append(s.queries, string(expr))
		switch {
		case s.failQuery:
			w.WriteHeader(http.StatusBadGateway)
		case s.absentRealm:
			_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":null,"Error":{"@type":"/vm.InvalidPkgPathError"}}}}}`))
		case s.realmAborts:
			_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":null,"Error":{"@type":"/std.InternalError"},"Log":"unknown collection"}}}}`))
		case s.raw != nil:
			writeAbciData(w, *s.raw)
		default:
			args := curationExprArgs.FindStringSubmatch(string(expr))
			if args == nil {
				t.Errorf("unexpected expression %q", expr)
				return
			}
			writeAbciData(w, curationPrint(curationAnswer(s.network, time.Now().Add(-s.blockAge), args[1], args[2], s.roles[args[2]])))
		}
	}))
	t.Cleanup(s.Close)
	t.Setenv("RPC_FALLBACK_URLS", s.URL) // never reach real nodes
	return s
}

func (s *curationStub) set(update func(*curationStub)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	update(s)
}

func (s *curationStub) queryCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queries)
}

func (s *curationStub) lastQuery() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queries) == 0 {
		return ""
	}
	return s.queries[len(s.queries)-1]
}

func TestCurationThreadAccess_Matrix(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	cases := []struct {
		name string
		role curationRole
		want bool
	}{
		{"founder", curationRole{founder: true}, true},
		{"manager", curationRole{manager: true}, true},
		{"conflicted manager", curationRole{manager: true, conflicted: true}, false},
		{"conflict mark without a seat", curationRole{conflicted: true}, false},
		{"stranger", curationRole{}, false},
	}
	for i, tc := range cases {
		account := curationTestAddr(t, byte(i+1))
		stub.set(func(s *curationStub) { s.roles[account] = tc.role })
		got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account)
		if err != nil || got != tc.want {
			t.Errorf("%s: got (%v, %v), want (%v, nil)", tc.name, got, err, tc.want)
		}
		want := `gno.land/r/samcrew/launchpad/curation/v1.AccessJSON("C7","` + account + `")`
		if last := stub.lastQuery(); last != want {
			t.Errorf("%s: evaluated %q, want %q", tc.name, last, want)
		}
	}
	// One request to the node per question, and nothing else.
	if stub.queryCount() != len(cases) {
		t.Fatalf("%d questions made %d requests", len(cases), stub.queryCount())
	}
}

// The print a real node gave for the realm, byte for byte.
func TestParseCurationAccess_RealNodeAnswer(t *testing.T) {
	const print = `("{\"chainId\":\"tendermint_test\",\"height\":\"31\",\"time\":\"1790778102\",\"collection\":\"C1\",\"account\":\"g1mxl8rd36lgkxv855kcjdxn2s9jvtymjvplve5r\",\"founder\":true,\"manager\":false,\"conflicted\":true}" string)`
	const account = "g1mxl8rd36lgkxv855kcjdxn2s9jvtymjvplve5r"
	at := time.Unix(1790778102, 0)

	if got, err := parseCurationAccess(print, "tendermint_test", "C1", account, at.Add(5*time.Second)); !got || err != nil {
		t.Fatalf("got (%v, %v), want the founder granted", got, err)
	}
	for name, now := range map[string]time.Time{
		"just past the bound":  at.Add(curationMaxBlockAge + time.Second),
		"block ahead of clock": at.Add(-curationMaxBlockAge - time.Second),
	} {
		if got, err := parseCurationAccess(print, "tendermint_test", "C1", account, now); got || !errors.Is(err, errCurationAnswer) {
			t.Errorf("%s: got (%v, %v), want (false, errCurationAnswer)", name, got, err)
		}
	}
	for name, now := range map[string]time.Time{"at the bound": at.Add(curationMaxBlockAge), "ahead, at the bound": at.Add(-curationMaxBlockAge)} {
		if got, err := parseCurationAccess(print, "tendermint_test", "C1", account, now); !got || err != nil {
			t.Errorf("%s: got (%v, %v), want granted", name, got, err)
		}
	}
	if got, err := parseCurationAccess(print, "gnoland-1", "C1", account, at); got || !errors.Is(err, errCurationAnswer) || !strings.Contains(err.Error(), "tendermint_test") {
		t.Fatalf("another chain: got (%v, %v), want a refusal that names the chain that answered", got, err)
	}
}

// An answer that is not exactly the realm's object for this chain, collection
// and account establishes nothing, even when it says founder:true.
func TestCurationThreadAccess_RefusesUnexpectedAnswers(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	account, other := curationTestAddr(t, 1), curationTestAddr(t, 2)
	now := strconv.FormatInt(time.Now().Unix(), 10)
	const roles = `"founder":true,"manager":true,"conflicted":false`
	object := func(head, collection, who, rest string) string {
		return fmt.Sprintf(`{%s,"collection":%q,"account":%q,%s}`, head, collection, who, rest)
	}
	head := func(chain, height, at string) string {
		return fmt.Sprintf(`"chainId":%s,"height":%s,"time":%s`, chain, height, at)
	}
	good := head(`"`+curationTestChain+`"`, `"1200"`, `"`+now+`"`)
	valid := object(good, "C7", account, roles)
	cases := map[string]string{
		"another collection echoed": curationPrint(object(good, "C8", account, roles)),
		"another account echoed":    curationPrint(object(good, "C7", other, roles)),
		"missing key":               curationPrint(object(good, "C7", account, `"founder":true,"manager":true`)),
		"extra key":                 curationPrint(object(good, "C7", account, roles+`,"admin":true`)),
		"key in another case":       curationPrint(object(good, "C7", account, `"Founder":true,"manager":true,"conflicted":false`)),
		"keys in another order":     curationPrint(object(good, "C7", account, `"manager":true,"founder":true,"conflicted":false`)),
		"key given twice":           curationPrint(object(good, "C7", account, `"founder":false,"founder":true,"conflicted":false`)),
		"boolean as string":         curationPrint(object(good, "C7", account, `"founder":"true","manager":true,"conflicted":false`)),
		"boolean as number":         curationPrint(object(good, "C7", account, `"founder":1,"manager":true,"conflicted":false`)),
		"null boolean":              curationPrint(object(good, "C7", account, `"founder":true,"manager":true,"conflicted":null`)),
		"null account":              curationPrint(`{` + good + `,"collection":"C7","account":null,` + roles + `}`),
		"answer without its origin": curationPrint(`{"collection":"C7","account":"` + account + `",` + roles + `}`),
		"another chain":             curationPrint(object(head(`"another-chain-1"`, `"1200"`, `"`+now+`"`), "C7", account, roles)),
		"chain id not a string":     curationPrint(object(head(`1`, `"1200"`, `"`+now+`"`), "C7", account, roles)),
		"height zero":               curationPrint(object(head(`"`+curationTestChain+`"`, `"0"`, `"`+now+`"`), "C7", account, roles)),
		"height negative":           curationPrint(object(head(`"`+curationTestChain+`"`, `"-5"`, `"`+now+`"`), "C7", account, roles)),
		"height not plain decimal":  curationPrint(object(head(`"`+curationTestChain+`"`, `"01200"`, `"`+now+`"`), "C7", account, roles)),
		"height as number":          curationPrint(object(head(`"`+curationTestChain+`"`, `1200`, `"`+now+`"`), "C7", account, roles)),
		"time as number":            curationPrint(object(head(`"`+curationTestChain+`"`, `"1200"`, now), "C7", account, roles)),
		"time not a number":         curationPrint(object(head(`"`+curationTestChain+`"`, `"1200"`, `"2026-09-30T10:00:00Z"`), "C7", account, roles)),
		"time zero":                 curationPrint(object(head(`"`+curationTestChain+`"`, `"1200"`, `"0"`), "C7", account, roles)),
		"trailing data":             curationPrint(valid + `{}`),
		"null":                      curationPrint("null"),
		"array":                     curationPrint("[" + valid + "]"),
		"another result type":       `(true bool)`,
		"no answer":                 "",
	}
	for name, raw := range cases {
		stub.set(func(s *curationStub) { s.raw = &raw })
		got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account)
		if got || !errors.Is(err, errCurationAnswer) {
			t.Errorf("%s: got (%v, %v), want (false, errCurationAnswer)", name, got, err)
		}
	}
	// The cases above differ from an accepted answer only by what they name.
	raw := curationPrint(valid)
	stub.set(func(s *curationStub) { s.raw = &raw })
	if got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account); !got || err != nil {
		t.Fatalf("the unaltered answer: got (%v, %v), want (true, nil)", got, err)
	}
}

// The answer must itself say it was read on the expected chain, at a recent
// block. A node that still shows a removed seat because it is behind, or that
// serves another chain under the same host name, is neither a grant nor a
// refusal.
func TestCurationThreadAccess_AnswerMustBeCurrentAndOfTheChain(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	account := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[account] = curationRole{founder: true, manager: true} })

	faults := map[string]func(*curationStub){
		"another chain":        func(s *curationStub) { s.network = "another-chain-1" },
		"block too old":        func(s *curationStub) { s.blockAge = curationMaxBlockAge + 30*time.Second },
		"block ahead of clock": func(s *curationStub) { s.blockAge = -curationMaxBlockAge - 30*time.Second },
	}
	for name, fault := range faults {
		stub.set(func(s *curationStub) { s.network, s.blockAge = curationTestChain, 0 })
		stub.set(fault)
		got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account)
		if got || !errors.Is(err, errCurationAnswer) {
			t.Errorf("%s: got (%v, %v), want (false, errCurationAnswer)", name, got, err)
		}
	}
	stub.set(func(s *curationStub) { s.network, s.blockAge = curationTestChain, curationMaxBlockAge-30*time.Second })
	if got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account); !got || err != nil {
		t.Fatalf("a block inside the bound: got (%v, %v), want (true, nil)", got, err)
	}
}

// Each node's answer is judged by itself. One that fails, lags, serves another
// chain or reports that the realm aborted is passed over, and the next node's
// answer decides — here a refusal, though the first node says founder.
func TestCurationThreadAccess_PassesOverANodeWithoutACurrentAnswer(t *testing.T) {
	account := curationTestAddr(t, 1)
	faults := map[string]func(*curationStub){
		"unreachable":   func(s *curationStub) { s.failQuery = true },
		"behind":        func(s *curationStub) { s.blockAge = curationMaxBlockAge + 30*time.Second },
		"another chain": func(s *curationStub) { s.network = "another-chain-1" },
		"realm absent":  func(s *curationStub) { s.absentRealm = true },
		"realm aborts":  func(s *curationStub) { s.realmAborts = true },
	}
	for name, fault := range faults {
		first := newCurationStub(t, curationTestChain)
		current := newCurationStub(t, curationTestChain)
		t.Setenv("RPC_FALLBACK_URLS", current.URL)
		first.set(func(s *curationStub) { s.roles[account] = curationRole{founder: true} })
		first.set(fault)

		got, err := curationThreadAccess(context.Background(), first.URL, curationTestChain, "C7", account)
		if got || err != nil {
			t.Errorf("%s: got (%v, %v), want the current node's answer (false, nil)", name, got, err)
		}
		if first.queryCount() != 1 || current.queryCount() != 1 {
			t.Errorf("%s: queries: first %d, current %d, want 1 and 1", name, first.queryCount(), current.queryCount())
		}
	}
}

func TestCurationThreadAccess_NoNodeAnswers(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	account := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[account] = curationRole{founder: true}; s.failQuery = true })
	if got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account); got || err == nil {
		t.Fatalf("failing query: got (%v, %v), want an error", got, err)
	}

	// A chain that does not have the realm: unavailable, and recognisable as such.
	stub.set(func(s *curationStub) { s.failQuery, s.absentRealm = false, true })
	if got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account); got || !errors.Is(err, errPackageNotFound) {
		t.Fatalf("absent realm: got (%v, %v), want (false, errPackageNotFound)", got, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stub.set(func(s *curationStub) { s.absentRealm = false })
	if got, err := curationThreadAccess(ctx, stub.URL, curationTestChain, "C7", account); got || err == nil {
		t.Fatalf("cancelled request: got (%v, %v), want an error", got, err)
	}

	stub.Close()
	if got, err := curationThreadAccess(context.Background(), stub.URL, curationTestChain, "C7", account); got || err == nil {
		t.Fatalf("unreachable node: got (%v, %v), want an error", got, err)
	}
}

func TestCurationThreadAccess_RejectsInvalidInput(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	account := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[account] = curationRole{founder: true} })
	for _, in := range [][3]string{
		{curationTestChain, "C0", account}, {curationTestChain, "7", account}, {curationTestChain, `C7")+x("`, account},
		{curationTestChain, "", account}, {curationTestChain, "C7", ""}, {curationTestChain, "C7", "g1notanaddress"},
		{curationTestChain, "C7", account + `"`}, {"", "C7", account},
	} {
		if got, err := curationThreadAccess(context.Background(), stub.URL, in[0], in[1], in[2]); got || err == nil {
			t.Errorf("%q: got (%v, %v), want an error", in, got, err)
		}
	}
	if n := stub.queryCount(); n != 0 {
		t.Fatalf("invalid input reached the chain %d times", n)
	}
}

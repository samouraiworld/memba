package service

import (
	"bytes"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

const curationTestKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func allowEveryWallet(string, string) bool { return true }

// newTestCurationInbox returns an inbox for chainID over database, reading
// access from stub.
func newTestCurationInbox(t *testing.T, database *sql.DB, chainID, keyHex string, stub *curationStub) *CurationInbox {
	t.Helper()
	t.Setenv(auth.AllowUnsignedAuthEnv, "")
	inbox, err := NewCurationInbox(database, chainID, keyHex, allowEveryWallet)
	if err != nil || inbox == nil {
		t.Fatalf("NewCurationInbox: %v, %v", inbox, err)
	}
	inbox.rpcURL = stub.URL
	return inbox
}

// curationCall sends one request as wallet (the address the session middleware
// would have put in the context; empty = no session).
func curationCall(inbox *CurationInbox, method, query, wallet, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/curation/inbox?"+query, strings.NewReader(body))
	if wallet != "" {
		r = r.WithContext(WithAuthAddress(r.Context(), wallet))
	}
	rec := httptest.NewRecorder()
	inbox.ServeHTTP(rec, r)
	return rec
}

func curationSendBody(clientID, text string) string {
	raw, _ := json.Marshal(map[string]string{"clientId": clientID, "body": text})
	return string(raw)
}

func decodeCuration[T any](t *testing.T, rec *httptest.ResponseRecorder, wantStatus int) T {
	t.Helper()
	var out T
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, wantStatus, rec.Body)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body, err)
	}
	return out
}

func curationRowCount(t *testing.T, database *sql.DB) int {
	t.Helper()
	var n int
	if err := database.QueryRow(`SELECT COUNT(*) FROM curation_inbox_messages`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCurationInbox_SendAndRead(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder, manager := curationTestAddr(t, 1), curationTestAddr(t, 2)
	stub.set(func(s *curationStub) {
		s.roles[founder] = curationRole{founder: true}
		s.roles[manager] = curationRole{manager: true}
	})
	const question, reply = "Is the provenance hash final? — é", "Yes. Please add the licence."

	first := decodeCuration[curationMessage](t,
		curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", question)), http.StatusCreated)
	if first.Seq != 1 || first.Sender != founder || first.Body != question || first.ClientID != "client-id-0001" || first.CreatedAt == 0 {
		t.Fatalf("first message = %+v", first)
	}
	decodeCuration[curationMessage](t,
		curationCall(inbox, http.MethodPost, "collection=C7", manager, curationSendBody("client-id-0002", reply)), http.StatusCreated)

	rec := curationCall(inbox, http.MethodGet, "collection=C7", founder, "")
	page := decodeCuration[curationThreadPage](t, rec, http.StatusOK)
	if page.ChainID != curationTestChain || page.Collection != "C7" || page.NextBefore != 0 || len(page.Messages) != 2 {
		t.Fatalf("page = %+v", page)
	}
	if newest, oldest := page.Messages[0], page.Messages[1]; newest.Seq != 2 || newest.Sender != manager || newest.Body != reply ||
		oldest.Seq != 1 || oldest.Sender != founder || oldest.Body != question {
		t.Fatalf("messages = %+v", page.Messages)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	// Another collection is another thread.
	if other := decodeCuration[curationThreadPage](t, curationCall(inbox, http.MethodGet, "collection=C8", founder, ""), http.StatusOK); len(other.Messages) != 0 {
		t.Fatalf("thread C8 = %+v, want empty", other.Messages)
	}

	// At rest: the clear columns are what was sent, the body is not.
	rows, err := database.Query(`SELECT chain_id, collection, sender, key_id, nonce, body FROM curation_inbox_messages ORDER BY seq`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for _, want := range []struct{ sender, text string }{{founder, question}, {manager, reply}} {
		var chain, collection, sender, keyID string
		var nonce, body []byte
		if !rows.Next() {
			t.Fatal("missing stored row")
		}
		if err := rows.Scan(&chain, &collection, &sender, &keyID, &nonce, &body); err != nil {
			t.Fatal(err)
		}
		if chain != curationTestChain || collection != "C7" || sender != want.sender || keyID != inbox.keyID || len(nonce) != 12 {
			t.Fatalf("stored row = %s %s %s %s nonce=%d bytes", chain, collection, sender, keyID, len(nonce))
		}
		if bytes.Contains(body, []byte(want.text)) || len(body) != len(want.text)+16 {
			t.Fatalf("stored body is not the sealed text: %d bytes %q", len(body), body)
		}
	}
	if strings.Contains(inbox.keyID, curationTestKey[:16]) || len(inbox.keyID) != 16 {
		t.Fatalf("key id %q must be a fingerprint, not key material", inbox.keyID)
	}
}

func TestCurationInbox_IdempotentRetry(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder, manager := curationTestAddr(t, 1), curationTestAddr(t, 2)
	stub.set(func(s *curationStub) {
		s.roles[founder] = curationRole{founder: true}
		s.roles[manager] = curationRole{manager: true}
	})
	send := func(wallet, clientID, text string) *httptest.ResponseRecorder {
		return curationCall(inbox, http.MethodPost, "collection=C7", wallet, curationSendBody(clientID, text))
	}

	first := decodeCuration[curationMessage](t, send(founder, "retry-0001", "hello"), http.StatusCreated)
	again := decodeCuration[curationMessage](t, send(founder, "retry-0001", "hello"), http.StatusOK)
	if again != first || curationRowCount(t, database) != 1 {
		t.Fatalf("retry = %+v, first = %+v, rows = %d", again, first, curationRowCount(t, database))
	}
	// The same id cannot carry another text.
	if rec := send(founder, "retry-0001", "something else"); rec.Code != http.StatusConflict {
		t.Fatalf("reused id with another text: status %d, want 409", rec.Code)
	}
	if curationRowCount(t, database) != 1 {
		t.Fatalf("a refused reuse stored a row")
	}
	// The id is the sender's own: another wallet may use the same one.
	if other := decodeCuration[curationMessage](t, send(manager, "retry-0001", "hello"), http.StatusCreated); other.Seq != 2 {
		t.Fatalf("other sender's message = %+v, want seq 2", other)
	}
}

func TestCurationInbox_RejectsBadRequests(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })

	cases := []struct {
		name, method, query, wallet, body string
		want                              int
	}{
		{"oversize text", http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", strings.Repeat("a", curationInboxMaxBody+1)), http.StatusRequestEntityTooLarge},
		{"oversize multi-byte text", http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", strings.Repeat("é", curationInboxMaxBody/2+1)), http.StatusRequestEntityTooLarge},
		{"oversize request", http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", strings.Repeat("a", 2*curationInboxMaxRequest)), http.StatusRequestEntityTooLarge},
		{"empty text", http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", " \n"), http.StatusBadRequest},
		{"missing client id", http.MethodPost, "collection=C7", founder, `{"body":"hello"}`, http.StatusBadRequest},
		{"malformed client id", http.MethodPost, "collection=C7", founder, curationSendBody("no spaces!", "hello"), http.StatusBadRequest},
		{"attachment field", http.MethodPost, "collection=C7", founder, `{"clientId":"client-id-0001","body":"hello","attachment":"x"}`, http.StatusBadRequest},
		{"claimed role field", http.MethodPost, "collection=C7", founder, `{"clientId":"client-id-0001","body":"hello","role":"manager"}`, http.StatusBadRequest},
		{"not JSON", http.MethodPost, "collection=C7", founder, "hello", http.StatusBadRequest},
		{"invalid collection", http.MethodPost, "collection=7", founder, curationSendBody("client-id-0001", "hello"), http.StatusBadRequest},
		{"missing collection", http.MethodGet, "", founder, "", http.StatusBadRequest},
		{"invalid cursor", http.MethodGet, "collection=C7&before=0", founder, "", http.StatusBadRequest},
		{"no session", http.MethodGet, "collection=C7", "", "", http.StatusUnauthorized},
		{"other method", http.MethodDelete, "collection=C7", founder, "", http.StatusMethodNotAllowed},
	}
	for _, tc := range cases {
		if rec := curationCall(inbox, tc.method, tc.query, tc.wallet, tc.body); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (body %s)", tc.name, rec.Code, tc.want, rec.Body)
		}
	}
	if rows, queries := curationRowCount(t, database), stub.queryCount(); rows != 0 || queries != 0 {
		t.Fatalf("refused requests stored %d rows and asked the chain %d times", rows, queries)
	}

	// The request bound itself: a small text in a request padded with JSON
	// whitespace is stopped while it is read.
	padded := `{"clientId":"client-id-0001","body":"hello"` + strings.Repeat(" ", 2*curationInboxMaxRequest) + `}`
	if rec := curationCall(inbox, http.MethodPost, "collection=C7", founder, padded); rec.Code != http.StatusRequestEntityTooLarge || curationRowCount(t, database) != 0 {
		t.Fatalf("padded request: status %d, rows %d, want 413 and nothing stored", rec.Code, curationRowCount(t, database))
	}

	// The bound is inclusive.
	decodeCuration[curationMessage](t, curationCall(inbox, http.MethodPost, "collection=C7", founder,
		curationSendBody("client-id-0001", strings.Repeat("a", curationInboxMaxBody))), http.StatusCreated)
}

// A role is read from the chain on every request: the wallet that could read a
// moment ago is refused as soon as the chain says otherwise.
func TestCurationInbox_AccessIsRecheckedOnEveryRequest(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder, manager, stranger := curationTestAddr(t, 1), curationTestAddr(t, 2), curationTestAddr(t, 3)
	stub.set(func(s *curationStub) {
		s.roles[founder] = curationRole{founder: true}
		s.roles[manager] = curationRole{manager: true}
	})
	decodeCuration[curationMessage](t,
		curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "for the managers")), http.StatusCreated)

	if page := decodeCuration[curationThreadPage](t, curationCall(inbox, http.MethodGet, "collection=C7", manager, ""), http.StatusOK); len(page.Messages) != 1 {
		t.Fatalf("manager read %d messages, want 1", len(page.Messages))
	}
	before := stub.queryCount()

	stub.set(func(s *curationStub) { s.roles[manager] = curationRole{manager: true, conflicted: true} })
	for _, rec := range []*httptest.ResponseRecorder{
		curationCall(inbox, http.MethodGet, "collection=C7", manager, ""),
		curationCall(inbox, http.MethodPost, "collection=C7", manager, curationSendBody("client-id-0002", "still here?")),
		curationCall(inbox, http.MethodGet, "collection=C7", stranger, ""),
		curationCall(inbox, http.MethodPost, "collection=C7", stranger, curationSendBody("client-id-0003", "hi")),
	} {
		if rec.Code != http.StatusForbidden || strings.Contains(rec.Body.String(), "for the managers") {
			t.Fatalf("status %d body %s, want 403 and no message", rec.Code, rec.Body)
		}
	}
	if got := stub.queryCount() - before; got != 4 {
		t.Fatalf("4 requests asked the chain %d times", got)
	}
	if n := curationRowCount(t, database); n != 1 {
		t.Fatalf("refused sends stored rows: %d", n)
	}

	// A seat that ended is refused the same way.
	stub.set(func(s *curationStub) { delete(s.roles, manager) })
	if rec := curationCall(inbox, http.MethodGet, "collection=C7", manager, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("former manager: status %d, want 403", rec.Code)
	}
}

// When the chain cannot be asked, the answer is "not available": never a
// refusal, never the thread.
func TestCurationInbox_UnavailableWhenAccessCannotBeEstablished(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	decodeCuration[curationMessage](t,
		curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "kept private")), http.StatusCreated)

	malformed := curationPrint(`{"collection":"C7","account":"` + founder + `","founder":true,"manager":false,"conflicted":false}`)
	faults := map[string]func(*curationStub){
		"query fails":      func(s *curationStub) { s.failQuery = true },
		"malformed answer": func(s *curationStub) { s.raw = &malformed },
		"wrong chain":      func(s *curationStub) { s.network = "another-chain-1" },
		"node behind":      func(s *curationStub) { s.blockAge = curationMaxBlockAge + 30*time.Second },
		"realm absent":     func(s *curationStub) { s.absentRealm = true },
		"realm aborts":     func(s *curationStub) { s.realmAborts = true },
	}
	for name, fault := range faults {
		stub.set(func(s *curationStub) {
			s.failQuery, s.raw, s.network, s.blockAge, s.absentRealm, s.realmAborts = false, nil, curationTestChain, 0, false, false
		})
		stub.set(fault)
		for _, rec := range []*httptest.ResponseRecorder{
			curationCall(inbox, http.MethodGet, "collection=C7", founder, ""),
			curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0002", "again")),
		} {
			if rec.Code != http.StatusServiceUnavailable || strings.Contains(rec.Body.String(), "kept private") {
				t.Fatalf("%s: status %d body %s, want 503 and no message", name, rec.Code, rec.Body)
			}
		}
	}
	if n := curationRowCount(t, database); n != 1 {
		t.Fatalf("sends stored rows while access was unknown: %d", n)
	}
}

// A request that cannot be served adds one bounded line to the log, however
// long the nodes' answers are.
func TestCurationInbox_UnavailableLogIsBounded(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	inbox := newTestCurationInbox(t, newTestService(t).db, curationTestChain, curationTestKey, stub)
	rpcError := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"error":{"message":"` + strings.Repeat("x", 1<<20) + `"}}`))
	}))
	defer rpcError.Close()

	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	refused := func(answer string) {
		t.Helper()
		logs.Reset()
		if rec := curationCall(inbox, http.MethodGet, "collection=C7", curationTestAddr(t, 1), ""); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s: status %d, want 503", answer, rec.Code)
		}
		if n := logs.Len(); n == 0 || n > 4*curationInboxMaxLoggedError {
			t.Errorf("%s: one request logged %d bytes, want one line of at most %d", answer, n, 4*curationInboxMaxLoggedError)
		}
	}

	notAString := "(" + strings.Repeat("7", 2<<20) + " int)"
	stub.set(func(s *curationStub) { s.raw = &notAString })
	refused("2 MiB that are not a string")

	inbox.rpcURL = rpcError.URL
	t.Setenv("RPC_FALLBACK_URLS", rpcError.URL)
	refused("1 MiB of RPC error message")
}

// Both per-wallet caps are applied before the chain is asked: one on every
// request, reads included, and one more on sends.
func TestCurationInbox_PerWalletCaps(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder, manager := curationTestAddr(t, 1), curationTestAddr(t, 2)
	stub.set(func(s *curationStub) {
		s.roles[founder] = curationRole{founder: true}
		s.roles[manager] = curationRole{manager: true}
	})
	var asked []string
	inbox.allow = func(wallet, endpoint string) bool {
		asked = append(asked, endpoint)
		overCap := (wallet == founder && endpoint == ratelimit.CurationSendEndpoint) ||
			(wallet == manager && endpoint == ratelimit.CurationInboxEndpoint)
		return !overCap
	}

	for name, rec := range map[string]*httptest.ResponseRecorder{
		"send over the send cap":  curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "hello")),
		"read over the inbox cap": curationCall(inbox, http.MethodGet, "collection=C7", manager, ""),
		"send over the inbox cap": curationCall(inbox, http.MethodPost, "collection=C7", manager, curationSendBody("client-id-0002", "hello")),
	} {
		if rec.Code != http.StatusTooManyRequests {
			t.Errorf("%s: status %d, want 429", name, rec.Code)
		}
	}
	if stub.queryCount() != 0 || curationRowCount(t, database) != 0 {
		t.Fatalf("a limited request reached the chain or the store")
	}
	// A read counts against the inbox cap only.
	asked = nil
	decodeCuration[curationThreadPage](t, curationCall(inbox, http.MethodGet, "collection=C7", founder, ""), http.StatusOK)
	if len(asked) != 1 || asked[0] != ratelimit.CurationInboxEndpoint {
		t.Fatalf("a read was counted against %v", asked)
	}
}

// The service's wallet limiter holds both buckets apart, per wallet.
func TestAllowUser_CurationBuckets(t *testing.T) {
	h := setup(t)
	if !h.svc.AllowUser("g1nolimit", ratelimit.CurationSendEndpoint) {
		t.Fatal("AllowUser must not block when no limiter is configured")
	}
	h.svc.SetUserLimiter(ratelimit.New(t.Context(), map[string]ratelimit.Config{
		ratelimit.CurationInboxEndpoint: {MaxRequests: 2, Window: time.Minute},
		ratelimit.CurationSendEndpoint:  {MaxRequests: 1, Window: time.Minute},
	}))
	if !h.svc.AllowUser("g1alice", ratelimit.CurationSendEndpoint) || h.svc.AllowUser("g1alice", ratelimit.CurationSendEndpoint) {
		t.Fatal("the send cap must admit one send, then block")
	}
	if !h.svc.AllowUser("g1alice", ratelimit.CurationInboxEndpoint) || !h.svc.AllowUser("g1bob", ratelimit.CurationSendEndpoint) {
		t.Fatal("another bucket, or another wallet, must not be blocked by alice's sends")
	}
	for _, endpoint := range []string{ratelimit.CurationInboxEndpoint, ratelimit.CurationSendEndpoint} {
		if _, ok := ratelimit.PerUserQuestConfigs(nil)[endpoint]; !ok {
			t.Fatalf("no per-wallet quota is configured for %q", endpoint)
		}
	}
}

// Two networks share the database and, here, even the key: neither reads nor
// numbers the other's thread, and a row relabelled to another chain does not
// open there.
func TestCurationInbox_ChainsNeverMix(t *testing.T) {
	const otherChain = "curation-test-2"
	database := newTestService(t).db
	stubA := newCurationStub(t, curationTestChain)
	stubB := newCurationStub(t, otherChain)
	inboxA := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stubA)
	inboxB := newTestCurationInbox(t, database, otherChain, curationTestKey, stubB)
	founder := curationTestAddr(t, 1)
	for _, stub := range []*curationStub{stubA, stubB} {
		stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	}
	t.Setenv("RPC_FALLBACK_URLS", stubA.URL+","+stubB.URL)

	decodeCuration[curationMessage](t,
		curationCall(inboxA, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "on chain one")), http.StatusCreated)

	if page := decodeCuration[curationThreadPage](t, curationCall(inboxB, http.MethodGet, "collection=C7", founder, ""), http.StatusOK); len(page.Messages) != 0 || page.ChainID != otherChain {
		t.Fatalf("chain two read chain one's thread: %+v", page)
	}
	// Same collection id, same sender, same client id: a separate message, numbered from 1.
	second := decodeCuration[curationMessage](t,
		curationCall(inboxB, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "on chain two")), http.StatusCreated)
	if second.Seq != 1 || second.Body != "on chain two" {
		t.Fatalf("chain two's message = %+v", second)
	}
	if page := decodeCuration[curationThreadPage](t, curationCall(inboxA, http.MethodGet, "collection=C7", founder, ""), http.StatusOK); len(page.Messages) != 1 || page.Messages[0].Body != "on chain one" {
		t.Fatalf("chain one's thread = %+v", page.Messages)
	}

	// Chain one's row, moved by hand into chain two's (emptied) thread.
	if _, err := database.Exec(`DELETE FROM curation_inbox_messages WHERE chain_id = ?`, otherChain); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`UPDATE curation_inbox_messages SET chain_id = ? WHERE chain_id = ?`, otherChain, curationTestChain); err != nil {
		t.Fatal(err)
	}
	moved := decodeCuration[curationThreadPage](t, curationCall(inboxB, http.MethodGet, "collection=C7", founder, ""), http.StatusOK)
	if len(moved.Messages) != 1 || !moved.Messages[0].Unreadable || moved.Messages[0].Body != "" {
		t.Fatalf("relabelled row = %+v, want one unreadable message without a body", moved.Messages)
	}
}

func TestCurationInbox_Pages(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	const total = curationInboxPageSize + 2
	for n := 1; n <= total; n++ {
		decodeCuration[curationMessage](t, curationCall(inbox, http.MethodPost, "collection=C7", founder,
			curationSendBody(fmt.Sprintf("client-id-%04d", n), fmt.Sprintf("message %d", n))), http.StatusCreated)
	}

	first := decodeCuration[curationThreadPage](t, curationCall(inbox, http.MethodGet, "collection=C7", founder, ""), http.StatusOK)
	if len(first.Messages) != curationInboxPageSize || first.Messages[0].Seq != total || first.NextBefore != 3 {
		t.Fatalf("first page: %d messages, newest seq %d, next %d", len(first.Messages), first.Messages[0].Seq, first.NextBefore)
	}
	rest := decodeCuration[curationThreadPage](t,
		curationCall(inbox, http.MethodGet, fmt.Sprintf("collection=C7&before=%d", first.NextBefore), founder, ""), http.StatusOK)
	if len(rest.Messages) != 2 || rest.Messages[0].Body != "message 2" || rest.Messages[1].Body != "message 1" || rest.NextBefore != 0 {
		t.Fatalf("last page = %+v", rest)
	}
}

// Without a key there is no inbox (the route answers "not available"); a key
// that is set but unusable is an error, and no inbox either.
func TestNewCurationInbox_Configuration(t *testing.T) {
	database := newTestService(t).db
	if inbox, err := NewCurationInbox(database, curationTestChain, "", allowEveryWallet); inbox != nil || err != nil {
		t.Fatalf("no key: got (%v, %v), want (nil, nil)", inbox, err)
	}
	for name, args := range map[string][2]string{
		"short key":   {curationTestChain, curationTestKey[:62]},
		"16-byte key": {curationTestChain, curationTestKey[:32]}, // a valid AES-128 key
		"24-byte key": {curationTestChain, curationTestKey[:48]}, // a valid AES-192 key
		"not hex":     {curationTestChain, strings.Repeat("z", 64)},
		"no chain id": {"", curationTestKey},
	} {
		if inbox, err := NewCurationInbox(database, args[0], args[1], allowEveryWallet); inbox != nil || err == nil {
			t.Errorf("%s: got (%v, %v), want an error and no inbox", name, inbox, err)
		}
	}
}

// A row that does not open is served as unreadable, without a body; it does
// not take the rest of the thread down with it.
func TestCurationInbox_UnreadableRowDoesNotHideTheThread(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	old := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	for n, text := range []string{"sealed under the first key", "nonce cut short", "still readable"} {
		decodeCuration[curationMessage](t, curationCall(old, http.MethodPost, "collection=C7", founder,
			curationSendBody(fmt.Sprintf("client-id-%04d", n+1), text)), http.StatusCreated)
	}
	// A nonce of the wrong length would panic in the cipher if it were passed on.
	if _, err := database.Exec(`UPDATE curation_inbox_messages SET nonce = x'0011' WHERE seq = 2`); err != nil {
		t.Fatal(err)
	}
	page := decodeCuration[curationThreadPage](t, curationCall(old, http.MethodGet, "collection=C7", founder, ""), http.StatusOK)
	if len(page.Messages) != 3 || page.Messages[0].Body != "still readable" || page.Messages[0].Unreadable ||
		!page.Messages[1].Unreadable || page.Messages[1].Body != "" || page.Messages[1].Seq != 2 ||
		page.Messages[2].Body != "sealed under the first key" {
		t.Fatalf("page = %+v", page.Messages)
	}
	// A retry of the send whose stored row no longer opens cannot be confirmed.
	if rec := curationCall(old, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0002", "nonce cut short")); rec.Code != http.StatusConflict {
		t.Fatalf("retry over an unreadable row: status %d, want 409", rec.Code)
	}

	// Under another key nothing opens, and nothing is served as noise.
	next := newTestCurationInbox(t, database, curationTestChain, strings.Repeat("ab", 32), stub)
	if next.keyID == old.keyID {
		t.Fatal("two keys share a key id")
	}
	page = decodeCuration[curationThreadPage](t, curationCall(next, http.MethodGet, "collection=C7", founder, ""), http.StatusOK)
	for _, m := range page.Messages {
		if !m.Unreadable || m.Body != "" {
			t.Fatalf("under another key: %+v, want unreadable without a body", m)
		}
	}
	if len(page.Messages) != 3 {
		t.Fatalf("under another key: %d messages, want 3", len(page.Messages))
	}
}

// Two sends of the same text are sealed under different nonces, to different
// ciphertexts.
func TestCurationInbox_NoncesAreNotReused(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	var nonces, bodies [2][]byte
	for n, id := range []string{"client-id-0001", "client-id-0002"} {
		decodeCuration[curationMessage](t, curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody(id, "same text")), http.StatusCreated)
		if err := database.QueryRow(`SELECT nonce, body FROM curation_inbox_messages WHERE client_id = ?`, id).Scan(&nonces[n], &bodies[n]); err != nil {
			t.Fatal(err)
		}
	}
	if bytes.Equal(nonces[0], nonces[1]) || bytes.Equal(bodies[0], bodies[1]) {
		t.Fatalf("two messages share a nonce or a ciphertext")
	}
}

// The sealed body is bound to every clear column of its row: a row whose
// collection, sender, client id or time was altered does not open anywhere.
func TestCurationInbox_AlteredRowDoesNotOpen(t *testing.T) {
	founder, manager := curationTestAddr(t, 1), curationTestAddr(t, 2)
	alterations := map[string]string{
		"collection": `UPDATE curation_inbox_messages SET collection = 'C8'`,
		"sender":     `UPDATE curation_inbox_messages SET sender = '` + manager + `'`,
		"client id":  `UPDATE curation_inbox_messages SET client_id = 'client-id-9999'`,
		"time":       `UPDATE curation_inbox_messages SET created_at = created_at + 86400`,
	}
	for name, stmt := range alterations {
		stub := newCurationStub(t, curationTestChain)
		database := newTestService(t).db
		inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
		stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
		decodeCuration[curationMessage](t,
			curationCall(inbox, http.MethodPost, "collection=C7", founder, curationSendBody("client-id-0001", "bound text")), http.StatusCreated)
		if _, err := database.Exec(stmt); err != nil {
			t.Fatal(err)
		}
		served := 0
		for _, collection := range []string{"C7", "C8"} {
			rec := curationCall(inbox, http.MethodGet, "collection="+collection, founder, "")
			page := decodeCuration[curationThreadPage](t, rec, http.StatusOK)
			if strings.Contains(rec.Body.String(), "bound text") {
				t.Fatalf("%s: altered row opened in %s", name, collection)
			}
			for _, m := range page.Messages {
				if served++; !m.Unreadable {
					t.Fatalf("%s: altered row served as readable in %s: %+v", name, collection, m)
				}
			}
		}
		if served != 1 {
			t.Fatalf("%s: the altered row was served %d times, want once, unreadable", name, served)
		}
	}
}

// A thread stops taking messages at its limit; a retry of a stored send still
// answers, and other threads are not affected.
func TestCurationInbox_ThreadLimit(t *testing.T) {
	stub := newCurationStub(t, curationTestChain)
	database := newTestService(t).db
	inbox := newTestCurationInbox(t, database, curationTestChain, curationTestKey, stub)
	founder := curationTestAddr(t, 1)
	stub.set(func(s *curationStub) { s.roles[founder] = curationRole{founder: true} })
	if _, err := database.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		INSERT INTO curation_inbox_messages (chain_id, collection, seq, sender, client_id, created_at, key_id, nonce, body)
		SELECT ?, 'C7', i, ?, 'filler-' || i, 1, 'none', x'00', x'00' FROM n`,
		curationInboxMaxMessages-1, curationTestChain, founder); err != nil {
		t.Fatal(err)
	}
	send := func(collection, clientID string) *httptest.ResponseRecorder {
		return curationCall(inbox, http.MethodPost, "collection="+collection, founder, curationSendBody(clientID, "hello"))
	}
	if last := decodeCuration[curationMessage](t, send("C7", "client-id-0001"), http.StatusCreated); last.Seq != curationInboxMaxMessages {
		t.Fatalf("last message = %+v, want seq %d", last, curationInboxMaxMessages)
	}
	if rec := send("C7", "client-id-0002"); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "message limit") {
		t.Fatalf("send to a full thread: status %d body %s, want 409 naming the limit", rec.Code, rec.Body)
	}
	decodeCuration[curationMessage](t, send("C7", "client-id-0001"), http.StatusOK)
	decodeCuration[curationMessage](t, send("C8", "client-id-0002"), http.StatusCreated)
	if n := curationRowCount(t, database); n != curationInboxMaxMessages+1 {
		t.Fatalf("%d rows, want %d in C7 and 1 in C8", n, curationInboxMaxMessages)
	}
}

// While unsigned logins are accepted, anyone can obtain a session for a
// founder's or a manager's public address: the inbox is not built.
func TestNewCurationInbox_RefusedWhileUnsignedAuthIsAllowed(t *testing.T) {
	database := newTestService(t).db
	for _, value := range []string{"1", "true", "TRUE"} {
		t.Setenv(auth.AllowUnsignedAuthEnv, value)
		if inbox, err := NewCurationInbox(database, curationTestChain, curationTestKey, allowEveryWallet); inbox != nil || err == nil {
			t.Fatalf("%s=%s: got (%v, %v), want an error and no inbox", auth.AllowUnsignedAuthEnv, value, inbox, err)
		}
	}
	for _, value := range []string{"", "0", "false"} {
		t.Setenv(auth.AllowUnsignedAuthEnv, value)
		if inbox, err := NewCurationInbox(database, curationTestChain, curationTestKey, allowEveryWallet); inbox == nil || err != nil {
			t.Fatalf("%s=%q: got (%v, %v), want an inbox", auth.AllowUnsignedAuthEnv, value, inbox, err)
		}
	}
}

// An inbox that is not configured answers like a configured one that cannot
// serve: the same JSON error, for every method, with or without a session.
func TestCurationInbox_NotConfigured(t *testing.T) {
	var inbox *CurationInbox
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		rec := curationCall(inbox, method, "collection=C7", curationTestAddr(t, 1), "")
		if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Content-Type") != "application/json" ||
			strings.TrimSpace(rec.Body.String()) != `{"error":"curation inbox not available"}` {
			t.Fatalf("%s: status %d, type %q, body %s", method, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
		}
	}
}

// The session validator reports the chain a token was issued for, so the inbox
// route can refuse a session of another chain.
func TestValidateRESTTokenIdentity_ReturnsTokenChain(t *testing.T) {
	h := setup(t)
	for _, chain := range []string{curationTestChain, ""} {
		token := &membav1.Token{Nonce: "00", UserAddress: "g1founder", ChainId: chain,
			Expiration: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
		unsigned, err := proto.Marshal(token)
		if err != nil {
			t.Fatal(err)
		}
		token.ServerSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(h.svc.privateKey, unsigned))
		addr, got, err := h.svc.ValidateRESTTokenIdentity(protojson.Format(token))
		if err != nil || addr != "g1founder" || got != chain {
			t.Fatalf("chain %q: got (%q, %q, %v)", chain, addr, got, err)
		}
	}
	if _, _, err := h.svc.ValidateRESTTokenIdentity("{not valid json"); err == nil {
		t.Fatal("malformed token JSON must be rejected")
	}
}

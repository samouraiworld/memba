package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testSafeAddr   = "0x1111111111111111111111111111111111111111"
	testSafeTxHash = "0x2222222222222222222222222222222222222222222222222222222222222222"
	testSafeAPIKey = "test-safe-api-key"
)

type seenRequest struct {
	method, path, query, body string
	header                    http.Header
}

// fakeSafeTxService records each request and answers with the handler's choice.
type fakeSafeTxService struct {
	mu     sync.Mutex
	seen   []seenRequest
	answer func(w http.ResponseWriter, r *http.Request)
}

func (f *fakeSafeTxService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.seen = append(f.seen, seenRequest{r.Method, r.URL.Path, r.URL.RawQuery, string(body), r.Header.Clone()})
	answer := f.answer
	f.mu.Unlock()
	if answer != nil {
		answer(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"ok":true}`)
}

func (f *fakeSafeTxService) calls() []seenRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.seen)
}

func newTestSafeTxProxy(t *testing.T, chains, key string) (*safeTxProxy, *fakeSafeTxService) {
	t.Helper()
	fake := &fakeSafeTxService{}
	srv := httptest.NewTLSServer(fake)
	t.Cleanup(srv.Close)
	cfg, _ := newSafeTxProxyConfig(srv.URL, chains, key)
	return newSafeTxProxy(cfg, srv.Client()), fake
}

func serve(h http.Handler, method, target, contentType, body string, header map[string]string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSafeTxProxyConfig(t *testing.T) {
	cfg, skipped := newSafeTxProxyConfig("https://up.example/tx-service/", " 84532, 8453 ,1,abc,,", "  k  ")
	if got := cfg.ChainIDs(); !slices.Equal(got, []uint64{8453, 84532}) {
		t.Fatalf("chains = %v", got)
	}
	if !slices.Equal(skipped, []string{"1", "abc"}) {
		t.Fatalf("skipped = %v", skipped)
	}
	if got := cfg.chainURL(cfg.chains[84532], "v1/about", "").String(); got != "https://up.example/tx-service/basesep/api/v1/about" {
		t.Fatalf("Base Sepolia URL = %q", got)
	}
	if got := cfg.chainURL(cfg.chains[8453], "v1/about", "limit=1").String(); got != "https://up.example/tx-service/base/api/v1/about?limit=1" {
		t.Fatalf("Base URL = %q", got)
	}
	if !cfg.HasAPIKey() || cfg.apiKey != "k" {
		t.Fatalf("key not trimmed")
	}
	off, _ := SafeTxProxyConfigFromEnv(func(string) string { return "" })
	if off.Enabled() || off.HasAPIKey() {
		t.Fatalf("unset env must be off")
	}
	prod, _ := SafeTxProxyConfigFromEnv(func(k string) string { return map[string]string{SafeTxChainsEnv: "84532"}[k] })
	if got := prod.chainURL("basesep", "v1/about", "").String(); got != "https://api.safe.global/tx-service/basesep/api/v1/about" {
		t.Fatalf("production URL = %q", got)
	}
	// Anything but a plain https upstream leaves the proxy off.
	for _, up := range []string{"http://up.example", "https://user:pw@up.example", "https://up.example?x=1", "ftp://up.example", "https://", "::"} {
		if cfg, skipped := newSafeTxProxyConfig(up, "84532", "k"); cfg.Enabled() || !slices.Equal(skipped, []string{"upstream"}) {
			t.Fatalf("upstream %q: enabled=%v skipped=%v, want off", up, cfg.Enabled(), skipped)
		}
	}
}

// The request is only ever sent to the configured https host.
func TestSafeTxProxy_FetchRefusesAnotherHost(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	for _, target := range []*url.URL{
		{Scheme: "https", Host: "evil.example", Path: "/basesep/api/v1/about"},
		{Scheme: "http", Host: p.cfg.upstream.Host, Path: "/basesep/api/v1/about"},
		{Scheme: "https", Host: p.cfg.upstream.Host, User: url.User("x"), Path: "/basesep/api/v1/about"},
	} {
		if _, err := p.fetch(t.Context(), http.MethodGet, target, nil); err != errSafeTxHost {
			t.Fatalf("%s: err = %v, want errSafeTxHost", target, err)
		}
	}
	if n := len(fake.calls()); n != 0 {
		t.Fatalf("upstream reached %d times", n)
	}
}

func TestSafeTxProxy_InertWhenOff(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "", testSafeAPIKey)
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		if rec := serve(p, m, "/api/safe-tx/84532/v1/about", "application/json", "{}", nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s while off: got %d, want 404", m, rec.Code)
		}
	}
	if n := len(fake.calls()); n != 0 {
		t.Fatalf("upstream reached %d times while off", n)
	}
}

func TestSafeTxProxy_OnlyConfiguredChains(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	for _, path := range []string{"/api/safe-tx/8453/v1/about", "/api/safe-tx/1/v1/about", "/api/safe-tx/base/v1/about", "/api/safe-tx/", "/api/safe-tx/84532"} {
		if rec := serve(p, http.MethodGet, path, "", "", nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: got %d, want 404", path, rec.Code)
		}
	}
	if n := len(fake.calls()); n != 0 {
		t.Fatalf("upstream reached %d times", n)
	}
}

func TestSafeTxProxy_ReadAllowlist(t *testing.T) {
	allowed := []string{
		"v1/about", "v1/about/", "v1/about/singletons/",
		"v1/owners/" + testSafeAddr + "/safes/",
		"v1/safes/" + testSafeAddr + "/", "v1/safes/" + testSafeAddr + "/creation/",
		"v1/safes/" + testSafeAddr + "/incoming-transfers/", "v1/safes/" + testSafeAddr + "/module-transactions/",
		"v2/safes/" + testSafeAddr + "/multisig-transactions/", "v2/safes/" + testSafeAddr + "/all-transactions/",
		"v2/multisig-transactions/" + testSafeTxHash + "/", "v1/multisig-transactions/" + testSafeTxHash + "/confirmations/",
		"v1/tokens/" + testSafeAddr + "/",
	}
	refused := []string{
		"v2/delegates/", "v1/messages/" + testSafeTxHash + "/", "v1/safes/" + testSafeAddr + "/messages/",
		"v1/safes/" + testSafeAddr + "/safe-operations/", "v1/safe-operations/" + testSafeTxHash + "/",
		"v1/safes/0x1234/", "v1/safes/" + testSafeAddr, "v1/safes/" + testSafeAddr + "/../../../admin/",
		"v1/data-decoder/", "v3/about", "",
	}
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	for _, path := range allowed {
		if rec := serve(p, http.MethodGet, "/api/safe-tx/84532/"+path, "", "", nil); rec.Code != http.StatusOK {
			t.Fatalf("GET %s: got %d, want 200", path, rec.Code)
		}
	}
	for _, path := range refused {
		if rec := serve(p, http.MethodGet, "/api/safe-tx/84532/"+path, "", "", nil); rec.Code != http.StatusNotFound {
			t.Fatalf("GET %s: got %d, want 404", path, rec.Code)
		}
	}
	calls := fake.calls()
	if len(calls) != len(allowed) {
		t.Fatalf("upstream reached %d times, want %d", len(calls), len(allowed))
	}
	if calls[3].path != "/basesep/api/v1/owners/"+testSafeAddr+"/safes/" {
		t.Fatalf("upstream path = %q", calls[3].path)
	}
}

func TestSafeTxProxy_WriteAllowlistAndBody(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	writes := []string{
		"v2/safes/" + testSafeAddr + "/multisig-transactions/",
		"v1/safes/" + testSafeAddr + "/multisig-transactions/estimations/",
		"v1/multisig-transactions/" + testSafeTxHash + "/confirmations/",
		"v1/data-decoder/",
	}
	for _, path := range writes {
		if rec := serve(p, http.MethodPost, "/api/safe-tx/84532/"+path, "application/json; charset=utf-8", `{"signature":"0xab"}`, nil); rec.Code != http.StatusOK {
			t.Fatalf("POST %s: got %d", path, rec.Code)
		}
	}
	for _, path := range []string{"v1/owners/" + testSafeAddr + "/safes/", "v2/delegates/", "v1/safes/" + testSafeAddr + "/messages/"} {
		if rec := serve(p, http.MethodPost, "/api/safe-tx/84532/"+path, "application/json", "{}", nil); rec.Code != http.StatusNotFound {
			t.Fatalf("POST %s: got %d, want 404", path, rec.Code)
		}
	}
	if rec := serve(p, http.MethodPost, "/api/safe-tx/84532/v1/data-decoder/", "text/plain", "{}", nil); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("non-JSON body: got %d, want 415", rec.Code)
	}
	big := `{"data":"` + strings.Repeat("a", safeTxMaxRequestBytes) + `"}`
	if rec := serve(p, http.MethodPost, "/api/safe-tx/84532/v1/data-decoder/", "application/json", big, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body: got %d, want 413", rec.Code)
	}
	for _, m := range []string{http.MethodPut, http.MethodDelete, http.MethodPatch} {
		if rec := serve(p, m, "/api/safe-tx/84532/v1/data-decoder/", "application/json", "{}", nil); rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: got %d, want 405", m, rec.Code)
		}
	}
	calls := fake.calls()
	if len(calls) != len(writes) {
		t.Fatalf("upstream reached %d times, want %d", len(calls), len(writes))
	}
	if calls[0].method != http.MethodPost || calls[0].body != `{"signature":"0xab"}` || calls[0].header.Get("Content-Type") != "application/json" {
		t.Fatalf("forwarded write = %+v", calls[0])
	}
}

func TestSafeTxProxy_HeadersAndKey(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	serve(p, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", map[string]string{
		"Authorization": "Bearer caller-token", "Cookie": "session=1", "X-Forwarded-For": "198.51.100.1", "X-Custom": "x",
	})
	h := fake.calls()[0].header
	if h.Get("Authorization") != "Bearer "+testSafeAPIKey {
		t.Fatalf("Authorization = %q, want the server key", h.Get("Authorization"))
	}
	for _, name := range []string{"Cookie", "X-Forwarded-For", "X-Custom"} {
		if h.Get(name) != "" {
			t.Fatalf("caller header %s was forwarded", name)
		}
	}

	keyless, fake2 := newTestSafeTxProxy(t, "84532", "")
	serve(keyless, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", map[string]string{"Authorization": "Bearer caller-token"})
	if got := fake2.calls()[0].header.Get("Authorization"); got != "" {
		t.Fatalf("keyless proxy sent Authorization %q", got)
	}
}

func TestSafeTxProxy_Query(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	path := "/api/safe-tx/84532/v2/safes/" + testSafeAddr + "/multisig-transactions/"
	if rec := serve(p, http.MethodGet, path+"?nonce__gte=4&executed=false&ordering=-nonce&limit=20", "", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("filters: got %d", rec.Code)
	}
	if q := fake.calls()[0].query; q != "executed=false&limit=20&nonce__gte=4&ordering=-nonce" {
		t.Fatalf("forwarded query = %q", q)
	}
	for _, q := range []string{"?a%5Bb%5D=1", "?url=http://evil/", "?x=a%20b", "?" + strings.Repeat("a=1&", safeTxMaxQueryParams+1), "?%zz"} {
		if rec := serve(p, http.MethodGet, path+q, "", "", nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("query %q: got %d, want 400", q, rec.Code)
		}
	}
	if n := len(fake.calls()); n != 1 {
		t.Fatalf("upstream reached %d times", n)
	}
}

func TestSafeTxProxy_StatusRelay(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	path := "/api/safe-tx/84532/v1/multisig-transactions/" + testSafeTxHash + "/confirmations/"
	cases := []struct {
		upstream int
		body     string
		want     int
	}{
		{http.StatusUnprocessableEntity, `{"signature":["not an owner"]}`, http.StatusUnprocessableEntity},
		{http.StatusBadRequest, `{"nonce":["too low"]}`, http.StatusBadRequest},
		{http.StatusNotFound, `{"detail":"Not found."}`, http.StatusNotFound},
		{http.StatusTooManyRequests, `{"detail":"slow down"}`, http.StatusTooManyRequests},
		{http.StatusInternalServerError, `<html>boom</html>`, http.StatusBadGateway},
		{http.StatusMovedPermanently, ``, http.StatusBadGateway},
	}
	for _, c := range cases {
		fake.mu.Lock()
		fake.answer = func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(c.upstream)
			_, _ = io.WriteString(w, c.body)
		}
		fake.mu.Unlock()
		rec := serve(p, http.MethodPost, path, "application/json", "{}", nil)
		if rec.Code != c.want {
			t.Fatalf("upstream %d: got %d, want %d", c.upstream, rec.Code, c.want)
		}
		if c.want < 500 && rec.Body.String() != c.body {
			t.Fatalf("upstream %d: body %q not relayed", c.upstream, rec.Body.String())
		}
		if c.want >= 500 && strings.Contains(rec.Body.String(), "boom") {
			t.Fatalf("upstream failure body leaked")
		}
		if c.upstream == http.StatusTooManyRequests && rec.Header().Get("Retry-After") != "30" {
			t.Fatalf("Retry-After not relayed")
		}
		if rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("upstream %d: headers %v", c.upstream, rec.Header())
		}
	}

	fake.mu.Lock()
	fake.answer = func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", safeTxMaxResponseBytes+1))
	}
	fake.mu.Unlock()
	if rec := serve(p, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("oversized response: got %d, want 502", rec.Code)
	}
}

func TestSafeTxProxy_RedirectStaysOnUpstreamHost(t *testing.T) {
	var elsewhere atomic.Int32
	other := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		elsewhere.Add(1)
		_, _ = io.WriteString(w, `{"leaked":"`+r.Header.Get("Authorization")+`"}`)
	}))
	t.Cleanup(other.Close)
	up := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/v1/about") {
			http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently) // same host: followed
			return
		}
		if strings.HasSuffix(r.URL.Path, "/v1/about/") {
			_, _ = io.WriteString(w, `{"name":"Safe Transaction Service"}`)
			return
		}
		http.Redirect(w, r, other.URL+"/steal", http.StatusFound) // another host: not followed
	}))
	t.Cleanup(up.Close)
	client := up.Client()
	client.CheckRedirect = safeTxSameHostRedirect
	cfg, _ := newSafeTxProxyConfig(up.URL, "84532", testSafeAPIKey)
	p := newSafeTxProxy(cfg, client)

	if rec := serve(p, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Safe Transaction Service") {
		t.Fatalf("same-host redirect: got %d %s", rec.Code, rec.Body.String())
	}
	if rec := serve(p, http.MethodGet, "/api/safe-tx/84532/v1/safes/"+testSafeAddr+"/", "", "", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("cross-host redirect: got %d, want 502", rec.Code)
	}
	if elsewhere.Load() != 0 {
		t.Fatalf("the proxy followed a redirect to another host")
	}
}

func TestSafeTxProxy_ReadCache(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532,8453", testSafeAPIKey)
	now := time.Unix(1_700_000_000, 0)
	p.now = func() time.Time { return now }
	read := func(chain string) *httptest.ResponseRecorder {
		return serve(p, http.MethodGet, "/api/safe-tx/"+chain+"/v2/safes/"+testSafeAddr+"/multisig-transactions/", "", "", nil)
	}

	if rec := read("84532"); rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "private, max-age=10" {
		t.Fatalf("first read: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	read("84532")
	if n := len(fake.calls()); n != 1 {
		t.Fatalf("a second read within the TTL reached upstream (%d calls)", n)
	}
	now = now.Add(safeTxCacheTTL)
	read("84532")
	if n := len(fake.calls()); n != 2 {
		t.Fatalf("an expired entry was served (%d calls)", n)
	}

	// A write on a chain empties that chain's cache, not the other's.
	read("8453")
	serve(p, http.MethodPost, "/api/safe-tx/84532/v1/multisig-transactions/"+testSafeTxHash+"/confirmations/", "application/json", "{}", nil)
	read("84532")
	read("8453")
	if n := len(fake.calls()); n != 5 {
		t.Fatalf("after a write: %d upstream calls, want 5 (the written chain re-read, the other cached)", n)
	}

	// A refused write leaves the cache alone; failures are never cached.
	fake.mu.Lock()
	fake.answer = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnprocessableEntity) }
	fake.mu.Unlock()
	serve(p, http.MethodPost, "/api/safe-tx/84532/v1/multisig-transactions/"+testSafeTxHash+"/confirmations/", "application/json", "{}", nil)
	read("84532")
	if n := len(fake.calls()); n != 6 {
		t.Fatalf("a refused write purged the cache (%d calls)", n)
	}
	serve(p, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", nil)
	serve(p, http.MethodGet, "/api/safe-tx/84532/v1/about", "", "", nil)
	if n := len(fake.calls()); n != 8 {
		t.Fatalf("a non-200 read was cached (%d calls)", n)
	}
}

func TestSafeTxProxy_ConcurrentMissesShareOneRequest(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	release := make(chan struct{})
	var arrived atomic.Int32
	fake.answer = func(w http.ResponseWriter, _ *http.Request) {
		arrived.Add(1)
		<-release
		_, _ = io.WriteString(w, `{"count":0}`)
	}
	var wg sync.WaitGroup
	codes := make([]int, 8)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = serve(p, http.MethodGet, "/api/safe-tx/84532/v1/owners/"+testSafeAddr+"/safes/", "", "", nil).Code
		}()
	}
	for arrived.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	for _, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("codes = %v", codes)
		}
	}
	if n := len(fake.calls()); n != 1 {
		t.Fatalf("%d upstream requests for 8 concurrent misses, want 1", n)
	}
}

// A read that started before a write must not store its now-stale answer.
func TestSafeTxProxy_ReadInFlightDuringWriteIsNotCached(t *testing.T) {
	p, fake := newTestSafeTxProxy(t, "84532", testSafeAPIKey)
	inRead := make(chan struct{})
	release := make(chan struct{})
	fake.answer = func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "multisig-transactions") {
			select {
			case <-inRead:
			default:
				close(inRead)
				<-release
			}
		}
		_, _ = io.WriteString(w, `{}`)
	}
	read := "/api/safe-tx/84532/v2/safes/" + testSafeAddr + "/multisig-transactions/"
	done := make(chan struct{})
	go func() { serve(p, http.MethodGet, read, "", "", nil); close(done) }()
	<-inRead
	serve(p, http.MethodPost, "/api/safe-tx/84532/v2/safes/"+testSafeAddr+"/multisig-transactions/", "application/json", "{}", nil)
	close(release)
	<-done
	serve(p, http.MethodGet, read, "", "", nil)
	if n := len(fake.calls()); n != 3 {
		t.Fatalf("%d upstream calls, want 3: the read after the write must not hit a stale cache", n)
	}
}

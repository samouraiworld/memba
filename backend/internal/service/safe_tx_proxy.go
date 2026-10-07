package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// The Safe Transaction Service proxy. The browser's Safe API client points its
// txServiceUrl here, so the API key stays on the server: a key shipped to the
// browser could be copied and spent by anyone, and the keyless quota (5,000
// requests per 30 days per IP) does not last a week of pending-signature polls.
//
// Inert by default: with MEMBA_EVM_SAFE_CHAINS unset every request is 404.
// The upstream host and each chain's path are fixed here, never taken from the
// request (no SSRF). Only the endpoints the Multisig app calls are forwarded,
// with only a JSON body and a fixed set of headers; the caller's headers,
// Authorization included, are never forwarded. Writes need no Memba session:
// the Transaction Service checks that each proposal and confirmation is signed
// by an owner of the Safe.

const (
	// SafeTxChainsEnv lists the EIP-155 chain ids the proxy serves, comma-separated (e.g. "84532").
	SafeTxChainsEnv = "MEMBA_EVM_SAFE_CHAINS"
	// SafeTxAPIKeyEnv holds the Safe API key sent upstream as a bearer token. Never logged.
	SafeTxAPIKeyEnv = "SAFE_TX_SERVICE_API_KEY"

	safeTxUpstream         = "https://api.safe.global/tx-service"
	safeTxRoutePrefix      = "/api/safe-tx/"
	safeTxTimeout          = 10 * time.Second
	safeTxMaxRequestBytes  = 256 << 10 // a proposal carries its calldata; a MultiSend batch can be long
	safeTxMaxResponseBytes = 2 << 20
	safeTxCacheTTL         = 10 * time.Second
	safeTxCacheMaxEntries  = 512
	safeTxMaxQueryParams   = 12
)

// safeTxNetworks maps the chains Memba supports to the Transaction Service's network names.
var safeTxNetworks = map[uint64]string{
	8453:  "base",
	84532: "basesep",
}

// SafeTxProxyConfig is what the proxy serves. The key is unexported so the config can be logged without it.
type SafeTxProxyConfig struct {
	chains map[uint64]string // chain id → the Transaction Service's network name
	apiKey string
	// The fixed upstream: https, its host and base path. Outside tests it is
	// always safeTxUpstream; nothing in a request can change it.
	upstream url.URL
}

// SafeTxProxyConfigFromEnv reads MEMBA_EVM_SAFE_CHAINS and SAFE_TX_SERVICE_API_KEY.
// Chain ids that are malformed or not supported are skipped and returned, so the
// caller can warn without blocking the boot.
func SafeTxProxyConfigFromEnv(getenv func(string) string) (SafeTxProxyConfig, []string) {
	return newSafeTxProxyConfig(safeTxUpstream, getenv(SafeTxChainsEnv), getenv(SafeTxAPIKeyEnv))
}

func newSafeTxProxyConfig(upstream, chainList, apiKey string) (SafeTxProxyConfig, []string) {
	cfg := SafeTxProxyConfig{chains: map[uint64]string{}, apiKey: strings.TrimSpace(apiKey)}
	u, err := url.Parse(strings.TrimRight(upstream, "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return cfg, []string{"upstream"} // never served over anything but a plain https URL
	}
	cfg.upstream = url.URL{Scheme: "https", Host: u.Host, Path: u.Path}
	var skipped []string
	for field := range strings.SplitSeq(chainList, ",") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		id, err := strconv.ParseUint(field, 10, 64)
		name, known := safeTxNetworks[id]
		if err != nil || !known {
			skipped = append(skipped, field)
			continue
		}
		cfg.chains[id] = name
	}
	return cfg, skipped
}

// chainURL is the upstream URL of one endpoint on one chain: always https on
// the configured host, the path built from the fixed network name and an
// endpoint the caller has already matched against an allowlist.
func (c SafeTxProxyConfig) chainURL(network, endpoint, query string) *url.URL {
	return &url.URL{Scheme: "https", Host: c.upstream.Host, Path: c.upstream.Path + "/" + network + "/api/" + endpoint, RawQuery: query}
}

// Enabled reports whether any chain is served.
func (c SafeTxProxyConfig) Enabled() bool { return len(c.chains) > 0 }

// HasAPIKey reports whether a key is configured (without revealing it).
func (c SafeTxProxyConfig) HasAPIKey() bool { return c.apiKey != "" }

// ChainIDs lists the served chain ids in ascending order.
func (c SafeTxProxyConfig) ChainIDs() []uint64 {
	ids := make([]uint64, 0, len(c.chains))
	for id := range c.chains {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}

const (
	safeAddrRe = `0x[0-9a-fA-F]{40}`
	safeHashRe = `0x[0-9a-fA-F]{64}`
)

// The endpoints the Safe API client calls for the Multisig app, by method.
// Delegates, messages and ERC-4337 operations are not forwarded.
var (
	safeTxReadPaths = regexp.MustCompile(`^(?:` + strings.Join([]string{
		`v1/about/?`,
		`v1/about/singletons/?`,
		`v1/owners/` + safeAddrRe + `/safes/`,
		`v1/safes/` + safeAddrRe + `/`,
		`v1/safes/` + safeAddrRe + `/creation/`,
		`v1/safes/` + safeAddrRe + `/incoming-transfers/`,
		`v1/safes/` + safeAddrRe + `/module-transactions/`,
		`v2/safes/` + safeAddrRe + `/multisig-transactions/`,
		`v2/safes/` + safeAddrRe + `/all-transactions/`,
		`v2/multisig-transactions/` + safeHashRe + `/`,
		`v1/multisig-transactions/` + safeHashRe + `/confirmations/`,
		`v1/tokens/` + safeAddrRe + `/`,
	}, "|") + `)$`)
	safeTxWritePaths = regexp.MustCompile(`^(?:` + strings.Join([]string{
		`v2/safes/` + safeAddrRe + `/multisig-transactions/`,
		`v1/safes/` + safeAddrRe + `/multisig-transactions/estimations/`,
		`v1/multisig-transactions/` + safeHashRe + `/confirmations/`,
		`v1/data-decoder/`,
	}, "|") + `)$`)
	safeTxQueryKey   = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)
	safeTxQueryValue = regexp.MustCompile(`^[A-Za-z0-9_.:,\-]{0,100}$`)
)

type safeTxCached struct {
	status  int
	body    []byte
	expires time.Time
}

type safeTxProxy struct {
	cfg    SafeTxProxyConfig
	client *http.Client
	now    func() time.Time

	mu    sync.Mutex
	cache map[string]safeTxCached
	gen   uint64 // bumped by every purge: a read that began before a write never stores its stale answer
	group singleflight.Group
}

// HandleSafeTxProxy serves /api/safe-tx/{chainId}/{v1|v2}/… for the configured chains.
func HandleSafeTxProxy(cfg SafeTxProxyConfig) http.Handler {
	return newSafeTxProxy(cfg, &http.Client{Timeout: safeTxTimeout, CheckRedirect: safeTxSameHostRedirect})
}

// safeTxSameHostRedirect follows a redirect only within the upstream host, so the key never leaves it.
func safeTxSameHostRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Host != via[0].URL.Host {
		return http.ErrUseLastResponse
	}
	return nil
}

func newSafeTxProxy(cfg SafeTxProxyConfig, client *http.Client) *safeTxProxy {
	return &safeTxProxy{cfg: cfg, client: client, now: time.Now, cache: map[string]safeTxCached{}}
}

func safeTxError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `{"error":"`+msg+`"}`)
}

func (p *safeTxProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !p.cfg.Enabled() {
		http.NotFound(w, r)
		return
	}
	rest, ok := strings.CutPrefix(r.URL.Path, safeTxRoutePrefix)
	if !ok {
		http.NotFound(w, r)
		return
	}
	chainPart, endpoint, _ := strings.Cut(rest, "/")
	chainID, err := strconv.ParseUint(chainPart, 10, 64)
	network, served := p.cfg.chains[chainID]
	if err != nil || !served {
		http.NotFound(w, r)
		return
	}
	query, ok := safeTxCleanQuery(r.URL.RawQuery)
	if !ok {
		safeTxError(w, http.StatusBadRequest, "query not allowed")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if !safeTxReadPaths.MatchString(endpoint) {
			http.NotFound(w, r)
			return
		}
		p.serveRead(w, r.Context(), p.cfg.chainURL(network, endpoint, query))
	case http.MethodPost:
		if !safeTxWritePaths.MatchString(endpoint) {
			http.NotFound(w, r)
			return
		}
		if mt := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]); !strings.EqualFold(mt, "application/json") {
			safeTxError(w, http.StatusUnsupportedMediaType, "JSON body required")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, safeTxMaxRequestBytes+1))
		if err != nil {
			safeTxError(w, http.StatusBadRequest, "failed to read request")
			return
		}
		if len(body) > safeTxMaxRequestBytes {
			safeTxError(w, http.StatusRequestEntityTooLarge, "request too large")
			return
		}
		p.serveWrite(w, r.Context(), chainID, p.cfg.chainURL(network, endpoint, query), body)
	default:
		w.Header().Set("Allow", "GET, POST")
		safeTxError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// safeTxCleanQuery re-encodes the query from plain filter keys and values only.
func safeTxCleanQuery(raw string) (string, bool) {
	if raw == "" {
		return "", true
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "", false
	}
	count := 0
	for key, vals := range values {
		if !safeTxQueryKey.MatchString(key) {
			return "", false
		}
		for _, v := range vals {
			count++
			if !safeTxQueryValue.MatchString(v) {
				return "", false
			}
		}
	}
	if count > safeTxMaxQueryParams {
		return "", false
	}
	return values.Encode(), true
}

type safeTxResult struct {
	status     int
	body       []byte
	retryAfter string
}

var (
	errSafeTxTooLarge = errors.New("safe tx service response too large")
	errSafeTxHost     = errors.New("safe tx service target is not the configured upstream")
)

func (p *safeTxProxy) fetch(ctx context.Context, method string, target *url.URL, body []byte) (safeTxResult, error) {
	if target.Scheme != "https" || target.Host != p.cfg.upstream.Host || target.User != nil {
		return safeTxResult{}, errSafeTxHost
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), reader) // #nosec G704 -- target is https on the fixed upstream host (asserted above), path = fixed network name + allowlist-matched endpoint, query re-encoded from allowlisted characters

	if err != nil {
		return safeTxResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "memba-safe-tx-proxy/1.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if p.cfg.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.cfg.apiKey)
	}
	resp, err := p.client.Do(req) // #nosec G704 -- fixed upstream host asserted above; redirects stay on that host (safeTxSameHostRedirect)
	if err != nil {
		return safeTxResult{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, safeTxMaxResponseBytes+1))
	if err != nil {
		return safeTxResult{}, err
	}
	if len(raw) > safeTxMaxResponseBytes {
		return safeTxResult{}, errSafeTxTooLarge
	}
	return safeTxResult{status: resp.StatusCode, body: raw, retryAfter: resp.Header.Get("Retry-After")}, nil
}

// relay writes the upstream answer. Client errors (the Transaction Service's
// reasons for refusing a proposal or confirmation) and 429 pass through;
// upstream failures become 502.
func relaySafeTx(w http.ResponseWriter, res safeTxResult, cacheControl string) {
	switch {
	case res.status >= 200 && res.status < 300:
		w.Header().Set("Cache-Control", cacheControl)
	case res.status == http.StatusTooManyRequests:
		if res.retryAfter != "" {
			w.Header().Set("Retry-After", res.retryAfter)
		}
		w.Header().Set("Cache-Control", "no-store")
	case res.status >= 400 && res.status < 500:
		w.Header().Set("Cache-Control", "no-store")
	default:
		safeTxError(w, http.StatusBadGateway, "upstream returned error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.status)
	_, _ = w.Write(res.body)
}

func (p *safeTxProxy) serveRead(w http.ResponseWriter, ctx context.Context, target *url.URL) {
	key := target.String()
	if res, ok := p.cached(key); ok {
		relaySafeTx(w, res, "private, max-age=10")
		return
	}
	// Concurrent misses for one URL share a single upstream request. The shared
	// request is detached from any one caller's cancellation, and bounded by the
	// client timeout.
	v, err, _ := p.group.Do(key, func() (any, error) {
		gen := p.generation()
		res, err := p.fetch(context.WithoutCancel(ctx), http.MethodGet, target, nil)
		if err == nil && res.status == http.StatusOK {
			p.store(key, res, gen)
		}
		return res, err
	})
	if err != nil {
		slog.Warn("safe tx proxy: upstream read failed", "error", err)
		safeTxError(w, http.StatusBadGateway, "upstream fetch failed")
		return
	}
	relaySafeTx(w, v.(safeTxResult), "private, max-age=10")
}

func (p *safeTxProxy) serveWrite(w http.ResponseWriter, ctx context.Context, chainID uint64, target *url.URL, body []byte) {
	res, err := p.fetch(ctx, http.MethodPost, target, body)
	if err != nil {
		slog.Warn("safe tx proxy: upstream write failed", "chain", chainID, "error", err)
		safeTxError(w, http.StatusBadGateway, "upstream fetch failed")
		return
	}
	if res.status >= 200 && res.status < 300 {
		// A new proposal or confirmation must show on the next read.
		p.purge(p.cfg.chainURL(p.cfg.chains[chainID], "", "").String())
	}
	relaySafeTx(w, res, "no-store")
}

func (p *safeTxProxy) cached(target string) (safeTxResult, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.cache[target]
	if !ok || !p.now().Before(e.expires) {
		return safeTxResult{}, false
	}
	return safeTxResult{status: e.status, body: e.body}, true
}

func (p *safeTxProxy) generation() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.gen
}

func (p *safeTxProxy) store(target string, res safeTxResult, gen uint64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if gen != p.gen {
		return
	}
	now := p.now()
	if len(p.cache) >= safeTxCacheMaxEntries {
		for k, e := range p.cache {
			if !now.Before(e.expires) {
				delete(p.cache, k)
			}
		}
		if len(p.cache) >= safeTxCacheMaxEntries {
			p.cache = map[string]safeTxCached{}
		}
	}
	p.cache[target] = safeTxCached{status: res.status, body: res.body, expires: now.Add(safeTxCacheTTL)}
}

func (p *safeTxProxy) purge(prefix string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gen++
	for k := range p.cache {
		if strings.HasPrefix(k, prefix) {
			delete(p.cache, k)
		}
	}
}

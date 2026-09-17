package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// chainStub is an RPC node that reports `network` in /status.
func chainStub(t *testing.T, network string, height string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = fmt.Fprintf(w, `{"result":{"node_info":{"network":%q},"sync_info":{"latest_block_height":%q,"latest_block_time":"2026-09-17T12:00:00Z"}}}`, network, height)
		case "/validators":
			_, _ = w.Write([]byte(`{"result":{"validators":[{},{}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func homeChainService(t *testing.T, serverChain string, accepted []string, rpcURL string) *MultisigService {
	t.Helper()
	s := newTestService(t)
	s.chainID = serverChain
	s.acceptedChainIDs = accepted
	s.homeQuery = func(rpc, path, data string) (string, error) { return "", fmt.Errorf("offline") }
	t.Setenv("HOME_SNAPSHOT_RPC_URL", rpcURL)
	t.Setenv("RPC_FALLBACK_URLS", rpcURL) // never reach real nodes
	return s
}

func homeCacheLen(s *MultisigService) int {
	s.homeCacheMu.RLock()
	defer s.homeCacheMu.RUnlock()
	return len(s.homeCached)
}

func wantConnectCode(t *testing.T, err error, code connect.Code) {
	t.Helper()
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != code {
		t.Fatalf("err = %v, want connect code %v", err, code)
	}
}

// Regression for the audit probe: a gnoland-1 request must not be answered or
// cached from the server's pearl-1 RPC.
func TestGetHomeSnapshot_RefusesChainWithoutItsOwnRPC(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "491036")
	s := homeChainService(t, "pearl-1", []string{"pearl-1", "gnoland1", "gnoland-1"}, pearl.URL)

	resp, err := s.GetHomeSnapshot(context.Background(),
		connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: "gnoland-1"}))
	if err == nil {
		t.Fatalf("expected refusal, got snapshot %+v", resp.Msg.GetSnapshot())
	}
	wantConnectCode(t, err, connect.CodeFailedPrecondition)
	if n := homeCacheLen(s); n != 0 {
		t.Fatalf("nothing may be cached for a refused chain, cache has %d entries", n)
	}
}

func TestGetHomeSnapshot_RefusesRPCReportingAnotherChain(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "491036")
	s := homeChainService(t, "gnoland-1", []string{"gnoland-1"}, pearl.URL)

	_, err := s.GetHomeSnapshot(context.Background(),
		connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: "gnoland-1"}))
	wantConnectCode(t, err, connect.CodeFailedPrecondition)
	if n := homeCacheLen(s); n != 0 {
		t.Fatalf("a snapshot from the wrong chain must not be cached, cache has %d entries", n)
	}
}

func TestGetHomeSnapshot_ServesVerifiedChain(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "491036")
	s := homeChainService(t, "pearl-1", []string{"pearl-1", "gnoland-1"}, pearl.URL)

	for _, chain := range []string{"pearl-1", ""} { // empty defaults to the server chain
		resp, err := s.GetHomeSnapshot(context.Background(),
			connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: chain}))
		if err != nil {
			t.Fatalf("chain %q: %v", chain, err)
		}
		if got := resp.Msg.GetSnapshot().GetAsOfBlock(); got != 491036 {
			t.Fatalf("chain %q: as_of_block = %d, want 491036", chain, got)
		}
	}
	s.homeCacheMu.RLock()
	_, ok := s.homeCached[homeCacheKey("pearl-1", pearl.URL)]
	n := len(s.homeCached)
	s.homeCacheMu.RUnlock()
	if !ok || n != 1 {
		t.Fatalf("want exactly one entry keyed by chain id and RPC, got %d (keyed=%v)", n, ok)
	}
}

func TestGetHomeSnapshot_RejectsUnacceptedChain(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "491036")
	s := homeChainService(t, "pearl-1", []string{"pearl-1"}, pearl.URL)

	for _, junk := range []string{"junk-1", "pearl"} {
		_, err := s.GetHomeSnapshot(context.Background(),
			connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: junk}))
		wantConnectCode(t, err, connect.CodeInvalidArgument)
	}
	if n := homeCacheLen(s); n != 0 {
		t.Fatalf("unaccepted chain ids must not touch the cache, cache has %d entries", n)
	}
}

func TestGetHomeSnapshot_NoServerChainConfigured(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "491036")
	s := homeChainService(t, "", nil, pearl.URL)

	_, err := s.GetHomeSnapshot(context.Background(), connect.NewRequest(&membav1.GetHomeSnapshotRequest{}))
	wantConnectCode(t, err, connect.CodeFailedPrecondition)
}

// When the configured RPC starts answering for another chain, the stale
// snapshot is not served either: the operator has to fix the RPC.
func TestGetHomeSnapshot_ChainSwitchDropsStale(t *testing.T) {
	var network atomic.Value
	network.Store("pearl-1")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = fmt.Fprintf(w, `{"result":{"node_info":{"network":%q},"sync_info":{"latest_block_height":"10","latest_block_time":"2026-09-17T12:00:00Z"}}}`, network.Load().(string))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	s := homeChainService(t, "pearl-1", []string{"pearl-1"}, srv.URL)

	req := connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: "pearl-1"})
	if _, err := s.GetHomeSnapshot(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	// Expire the entry and switch the node to another chain.
	s.homeCacheMu.Lock()
	for k := range s.homeCachedAt {
		s.homeCachedAt[k] = time.Now().Add(-time.Hour)
	}
	s.homeCacheMu.Unlock()
	network.Store("gnoland-1")

	_, err := s.GetHomeSnapshot(context.Background(), req)
	wantConnectCode(t, err, connect.CodeFailedPrecondition)
	if n := homeCacheLen(s); n != 0 {
		t.Fatalf("the entry for an RPC that changed chain must be dropped, cache has %d entries", n)
	}
}

// An unreachable node is not a chain mismatch: the handler keeps its old
// degrade-to-empty behaviour so the frontend falls back to per-source reads.
func TestGetHomeSnapshot_UnreachableRPCDegrades(t *testing.T) {
	s := homeChainService(t, "pearl-1", []string{"pearl-1"}, "http://127.0.0.1:1")

	resp, err := s.GetHomeSnapshot(context.Background(),
		connect.NewRequest(&membav1.GetHomeSnapshotRequest{ChainId: "pearl-1"}))
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.Msg.GetSnapshot().GetStaleSources(); len(got) != 1 || got[0] != "all" {
		t.Fatalf("stale_sources = %v, want [all]", got)
	}
}

func TestVerifyRPCChain(t *testing.T) {
	pearl := chainStub(t, "pearl-1", "1")
	if err := verifyRPCChain(context.Background(), pearl.URL, "pearl-1"); err != nil {
		t.Fatalf("matching network: %v", err)
	}
	err := verifyRPCChain(context.Background(), pearl.URL, "gnoland-1")
	if !errors.Is(err, errHomeChainMismatch) {
		t.Fatalf("mismatch: err = %v, want errHomeChainMismatch", err)
	}
	if err := verifyRPCChain(context.Background(), pearl.URL, ""); !errors.Is(err, errHomeChainMismatch) {
		t.Fatalf("empty expected chain must fail closed, got %v", err)
	}
	if err := verifyRPCChain(context.Background(), "http://127.0.0.1:1", "pearl-1"); err == nil || errors.Is(err, errHomeChainMismatch) {
		t.Fatalf("unreachable node must be a transport error, got %v", err)
	}
}

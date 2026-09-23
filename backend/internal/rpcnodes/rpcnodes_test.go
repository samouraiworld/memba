package rpcnodes

import (
	"slices"
	"strings"
	"testing"
)

func TestURLsInOrder_PrimaryFirstAndDeduped(t *testing.T) {
	// Pick a primary that IS one of the defaults: it must not appear twice.
	primary := defaultMainnetFallbacks[1]
	got := URLsInOrder(primary)

	if got[0] != primary {
		t.Fatalf("primary must come first, got %q", got[0])
	}
	seen := map[string]bool{}
	for _, u := range got {
		if seen[u] {
			t.Fatalf("duplicate node %q in ordered list %v", u, got)
		}
		seen[u] = true
	}
	if len(got) != len(defaultMainnetFallbacks) {
		t.Fatalf("dedup miscount: got %d urls, want %d", len(got), len(defaultMainnetFallbacks))
	}
}

func TestFallbackURLs_EnvOverrideTrimsAndDropsBlanks(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", " https://a.example:443 ,, https://b.example:443 ")
	got := FallbackURLs()
	want := []string{"https://a.example:443", "https://b.example:443"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestFallbackURLs_EmptyEnvYieldsDefaults(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", "   ")
	if got := FallbackURLs(); !slices.Equal(got, defaultMainnetFallbacks) {
		t.Fatalf("blank env must yield the built-in list, got %v", got)
	}
}

// retiredChainMarkers are substrings of hosts for chains that no longer exist
// (pearl joined the list at the 2026-09-23 mainnet cutover).
// A default that names one of them is a failover list that can never succeed —
// or, worse, one that answers from the wrong chain if the host is ever reused.
var retiredChainMarkers = []string{"pearl", "sapphire", "topaz", "test13", "testnet13", "test-13", "test12"}

// mainnetHosts are the hosts that serve gnoland-1. Every built-in fallback must
// be one of them: failover is transport-only, so a host from any other chain
// would answer from the wrong chain.
var mainnetHosts = []string{"https://rpc.gno.land", "https://rpc.mainnet.samourai.live"}

func TestFallbackURLs_DefaultsAreMainnetAndNameNoRetiredChain(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", "")
	got := FallbackURLs()
	if len(got) == 0 {
		t.Fatal("built-in fallback list must not be empty")
	}
	for _, u := range got {
		for _, marker := range retiredChainMarkers {
			if strings.Contains(u, marker) {
				t.Errorf("default fallback %q names retired chain marker %q", u, marker)
			}
		}
		if !slices.ContainsFunc(mainnetHosts, func(h string) bool { return strings.HasPrefix(u, h) }) {
			t.Errorf("default fallback %q is not a gnoland-1 mainnet node", u)
		}
	}
}

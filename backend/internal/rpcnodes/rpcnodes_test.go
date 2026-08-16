package rpcnodes

import (
	"slices"
	"testing"
)

func TestURLsInOrder_PrimaryFirstAndDeduped(t *testing.T) {
	// Pick a primary that IS one of the defaults: it must not appear twice.
	primary := defaultSapphireFallbacks[1]
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
	if len(got) != len(defaultSapphireFallbacks) {
		t.Fatalf("dedup miscount: got %d urls, want %d", len(got), len(defaultSapphireFallbacks))
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
	if got := FallbackURLs(); !slices.Equal(got, defaultSapphireFallbacks) {
		t.Fatalf("blank env must yield the built-in list, got %v", got)
	}
}

package evmauth

import (
	"slices"
	"strings"
	"testing"
)

func TestParseRPCURLs(t *testing.T) {
	r, problems := ParseRPCURLs(" 84532=https://a.example/v2/SECRET , 8453=https://b.example ,garbage, 10=https://c.example,10=https://d.example/SECRET,10=https://e.example,,")
	if u, ok := r.For(84532); !ok || u != "https://a.example/v2/SECRET" {
		t.Fatalf("84532 = %q %v", u, ok)
	}
	if u, ok := r.For(8453); !ok || u != "https://b.example" {
		t.Fatalf("8453 = %q %v", u, ok)
	}
	if _, ok := r.For(10); ok || !r.Duplicated(10) {
		t.Fatal("a chain listed twice must have no endpoint")
	}
	if _, ok := r.For(1); ok || r.Duplicated(1) {
		t.Fatal("an unlisted chain has no endpoint")
	}
	if got := r.Chains(); !slices.Equal(got, []uint64{10, 8453, 84532}) {
		t.Fatalf("chains = %v", got)
	}
	if len(problems) != 2 || !strings.Contains(problems[0], "not <chain id>=<url>") || !strings.Contains(problems[1], "chain 10 listed twice") {
		t.Fatalf("problems = %v", problems)
	}
	for _, p := range problems {
		if strings.Contains(p, "SECRET") || strings.Contains(p, "example") {
			t.Fatalf("a problem leaks an endpoint: %q", p)
		}
	}
	if r, p := ParseRPCURLs(""); len(r.Chains()) != 0 || len(p) != 0 {
		t.Fatal("empty variable must be empty")
	}
	if _, p := ParseRPCURLs("0x1=https://a.example,08453=https://a.example"); len(p) != 2 {
		t.Fatalf("non-canonical chain ids must be refused: %v", p)
	}
}

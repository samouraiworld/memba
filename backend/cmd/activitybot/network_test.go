package main

import (
	"strings"
	"testing"
)

func TestCheckNetwork_RequiresChainIDAndRemote(t *testing.T) {
	cases := []struct{ name, chainID, remote, want string }{
		{"no chain id", "", "https://rpc.test13.testnets.gno.land:443", "-chain-id is required"},
		{"blank chain id", "  ", "https://rpc.test13.testnets.gno.land:443", "-chain-id is required"},
		{"no remote", "test-13", "", "-remote is required"},
		{"blank remote", "test-13", " ", "-remote is required"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := checkNetwork(c.chainID, c.remote)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("checkNetwork(%q, %q) = %v, want error containing %q", c.chainID, c.remote, err, c.want)
			}
		})
	}
}

func TestCheckNetwork_RefusesMainnet(t *testing.T) {
	for _, id := range []string{"gnoland-1", "gnoland1", "GNOLAND-1", " gnoland1 "} {
		err := checkNetwork(id, "https://rpc.gno.land:443")
		if err == nil || !strings.Contains(err.Error(), "mainnet") {
			t.Fatalf("checkNetwork(%q) = %v, want a mainnet refusal", id, err)
		}
	}
}

func TestCheckNetwork_AcceptsTestnet(t *testing.T) {
	for _, id := range []string{"test-13", "pearl-1", "dev"} {
		if err := checkNetwork(id, "https://rpc.example.testnets.gno.land:443"); err != nil {
			t.Fatalf("checkNetwork(%q) = %v, want nil", id, err)
		}
	}
}

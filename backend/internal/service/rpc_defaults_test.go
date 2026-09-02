package service

import (
	"strings"
	"testing"
)

// The built-in RPC/indexer defaults are what an environment gets when it forgets
// a secret. They must all name the chain this release serves (pearl-1) and never
// a retired one: a retired host is at best dead and at worst answers from the
// wrong chain, and failover here is transport-only (no chain-identity check).
func TestRPCDefaults_ArePearlAndNameNoRetiredChain(t *testing.T) {
	for _, env := range []string{
		"GNO_RPC_URL", "NFT_RPC_URL", "QUEST_RPC_URL", "MARKETPLACE_RPC_URL",
		"HOME_SNAPSHOT_RPC_URL", "INDEXER_GRAPHQL_URL",
	} {
		t.Setenv(env, "")
	}
	retired := []string{"sapphire", "topaz", "test13", "testnet13", "test-13", "test12"}
	defaults := map[string]func() string{
		"gnoRPCURL":          gnoRPCURL,
		"marketplaceRPCURL":  marketplaceRPCURL,
		"questRPCURL":        questRPCURL,
		"homeSnapshotRPCURL": homeSnapshotRPCURL,
		"indexerURL":         indexerURL,
	}
	for name, fn := range defaults {
		got := fn()
		for _, marker := range retired {
			if strings.Contains(got, marker) {
				t.Errorf("%s() default %q names retired chain marker %q", name, got, marker)
			}
		}
		if !strings.Contains(got, "pearl") {
			t.Errorf("%s() default %q is not a pearl endpoint", name, got)
		}
	}
}

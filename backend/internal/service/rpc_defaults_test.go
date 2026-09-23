package service

import (
	"strings"
	"testing"
)

// The built-in RPC/indexer defaults are what an environment gets when it forgets
// a secret. They must all name the chain this release serves (gno.land mainnet,
// gnoland-1, since the 2026-09-23 cutover) and never a retired one — pearl
// included: a retired host is at best dead and at worst answers from the
// wrong chain, and failover here is transport-only (no chain-identity check).
func TestRPCDefaults_AreMainnetAndNameNoRetiredChain(t *testing.T) {
	for _, env := range []string{
		"GNO_RPC_URL", "NFT_RPC_URL", "QUEST_RPC_URL", "MARKETPLACE_RPC_URL",
		"HOME_SNAPSHOT_RPC_URL", "INDEXER_GRAPHQL_URL",
	} {
		t.Setenv(env, "")
	}
	retired := []string{"pearl", "sapphire", "topaz", "test13", "testnet13", "test-13", "test12"}
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
		if !strings.HasPrefix(got, "https://rpc.gno.land") &&
			!strings.HasPrefix(got, "https://rpc.mainnet.samourai.live") &&
			!strings.HasPrefix(got, "https://indexer.gno.land/") {
			t.Errorf("%s() default %q is not a gnoland-1 mainnet endpoint", name, got)
		}
	}
}

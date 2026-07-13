package service

import "testing"

// TestAgentRegistryRealmPath pins the env-precedence contract of the shared
// helper: the canonical AGENT_REGISTRY_REALM_PATH wins, the legacy
// AGENT_REGISTRY_REALM is honored only as a one-release fallback, and the v2
// realm is the default when neither is set.
func TestAgentRegistryRealmPath(t *testing.T) {
	const (
		canonical = "AGENT_REGISTRY_REALM_PATH"
		legacy    = "AGENT_REGISTRY_REALM"
		defPath   = "gno.land/r/samcrew/agent_registry_v2"
	)

	tests := []struct {
		name         string
		canonicalVal string
		legacyVal    string
		want         string
	}{
		{
			name: "defaults to v2 when neither env is set",
			want: defPath,
		},
		{
			name:         "canonical env overrides the default",
			canonicalVal: "gno.land/r/samcrew/agent_registry_v9",
			want:         "gno.land/r/samcrew/agent_registry_v9",
		},
		{
			name:      "legacy env is honored as a one-release fallback",
			legacyVal: "gno.land/r/samcrew/agent_registry_legacy",
			want:      "gno.land/r/samcrew/agent_registry_legacy",
		},
		{
			name:         "canonical takes precedence over legacy when both are set",
			canonicalVal: "gno.land/r/samcrew/agent_registry_v9",
			legacyVal:    "gno.land/r/samcrew/agent_registry_legacy",
			want:         "gno.land/r/samcrew/agent_registry_v9",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Force both to a known state (empty == unset for this helper) so the
			// test is hermetic regardless of the ambient environment.
			t.Setenv(canonical, tt.canonicalVal)
			t.Setenv(legacy, tt.legacyVal)
			if got := AgentRegistryRealmPath(); got != tt.want {
				t.Fatalf("AgentRegistryRealmPath() = %q, want %q", got, tt.want)
			}
		})
	}
}

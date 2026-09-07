package service

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// TestAgentRegistryRealmPath pins the env contract of the shared helper: the
// canonical AGENT_REGISTRY_REALM_PATH is the only setting read, the legacy
// AGENT_REGISTRY_REALM alias (retired one release after v7.4.0) is ignored,
// and the v2 realm is the default when the canonical variable is unset.
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
			name:      "legacy alias alone is ignored — default wins",
			legacyVal: "gno.land/r/samcrew/agent_registry_legacy",
			want:      defPath,
		},
		{
			name:         "canonical wins when both are set",
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

// A set-but-ignored legacy alias must be visible at startup: an operator who
// only ever set AGENT_REGISTRY_REALM would otherwise get the default realm
// with no signal. The warning names the canonical variable to set instead.
func TestWarnIgnoredAgentRegistryAlias(t *testing.T) {
	const (
		canonical = "AGENT_REGISTRY_REALM_PATH"
		legacy    = "AGENT_REGISTRY_REALM"
	)

	capture := func(t *testing.T) *bytes.Buffer {
		t.Helper()
		var buf bytes.Buffer
		prev := slog.Default()
		slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
		t.Cleanup(func() { slog.SetDefault(prev) })
		return &buf
	}

	t.Run("alias set → one warning naming the canonical variable", func(t *testing.T) {
		t.Setenv(canonical, "")
		t.Setenv(legacy, "gno.land/r/samcrew/agent_registry_legacy")
		buf := capture(t)
		WarnIgnoredAgentRegistryAlias()
		out := buf.String()
		if !strings.Contains(out, "level=WARN") {
			t.Fatalf("expected a WARN line, got %q", out)
		}
		if !strings.Contains(out, legacy) || !strings.Contains(out, canonical) {
			t.Fatalf("warning must name both the ignored alias %s and the canonical %s, got %q", legacy, canonical, out)
		}
	})

	t.Run("alias unset → silent", func(t *testing.T) {
		t.Setenv(canonical, "")
		t.Setenv(legacy, "")
		buf := capture(t)
		WarnIgnoredAgentRegistryAlias()
		if buf.Len() != 0 {
			t.Fatalf("expected no log output, got %q", buf.String())
		}
	})
}

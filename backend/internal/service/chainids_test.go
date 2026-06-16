package service

import (
	"slices"
	"testing"
)

func TestParseAcceptedChainIDs(t *testing.T) {
	cases := []struct {
		name, env, def string
		want           []string
	}{
		{"unset falls back to configured chain", "", "test12", []string{"test12"}},
		{"unset + no chain = legacy any", "", "", nil},
		{"transition allowlist", "test12,test-13", "test12", []string{"test12", "test-13"}},
		{"trims + drops empties", " test12 , , test-13 ,", "test12", []string{"test12", "test-13"}},
		{"single override", "test-13", "test12", []string{"test-13"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := parseAcceptedChainIDs(c.env, c.def)
			if !slices.Equal(got, c.want) {
				t.Fatalf("parseAcceptedChainIDs(%q,%q) = %v, want %v", c.env, c.def, got, c.want)
			}
		})
	}
}

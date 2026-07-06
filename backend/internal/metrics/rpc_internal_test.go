package metrics

import (
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/prometheus/client_golang/prometheus"
)

// codeFor maps handler results to the "code" label. White-box so the real,
// non-"unknown" labeling paths are covered (the interceptor test can only ever
// see an empty Spec → "unknown").
func TestCodeFor(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, "ok"},
		{"connect code", connect.NewError(connect.CodeInvalidArgument, errors.New("x")), "invalid_argument"},
		{"plain error", errors.New("plain"), "unknown"}, // CodeOf → CodeUnknown
	}
	for _, tc := range cases {
		if got := codeFor(tc.err); got != tc.want {
			t.Errorf("codeFor(%s) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// observeRPC must record against the REAL procedure label (not the "unknown"
// fallback) and must map an empty procedure to "unknown".
func TestObserveRPC_Labels(t *testing.T) {
	const proc = "/test.metrics.Svc/Alpha"
	before := internalHistCount(t, proc, "ok")
	observeRPC(proc, "ok", 2*time.Millisecond)
	if got := internalHistCount(t, proc, "ok"); got != before+1 {
		t.Fatalf("real-procedure sample not recorded: before=%d after=%d", before, got)
	}

	unknownBefore := internalHistCount(t, "unknown", "ok")
	observeRPC("", "ok", time.Millisecond)
	if got := internalHistCount(t, "unknown", "ok"); got != unknownBefore+1 {
		t.Fatalf("empty procedure not mapped to \"unknown\": before=%d after=%d", unknownBefore, got)
	}
}

func internalHistCount(t *testing.T, procedure, code string) uint64 {
	t.Helper()
	fams, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	for _, f := range fams {
		if f.GetName() != "memba_rpc_duration_seconds" {
			continue
		}
		for _, m := range f.GetMetric() {
			var p, c string
			for _, l := range m.GetLabel() {
				switch l.GetName() {
				case "procedure":
					p = l.GetValue()
				case "code":
					c = l.GetValue()
				}
			}
			if p == procedure && c == code {
				return m.GetHistogram().GetSampleCount()
			}
		}
	}
	return 0
}

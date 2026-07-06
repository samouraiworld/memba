package metrics_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	"google.golang.org/protobuf/types/known/emptypb"
)

// The interceptor must be transparent: the wrapped handler's response and error
// pass through unchanged, and in-flight is balanced (every Inc paired with a Dec).
func TestUnaryTimingInterceptor_PassesThrough(t *testing.T) {
	timing := metrics.UnaryTimingInterceptor()
	inFlightBefore := testutil.ToFloat64(metrics.RPCInFlight)

	sentinel := errors.New("boom")
	okResp := connect.NewResponse(&emptypb.Empty{})

	okNext := connect.UnaryFunc(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return okResp, nil
	})
	errNext := connect.UnaryFunc(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, connect.NewError(connect.CodeInternal, sentinel)
	})

	// Success path: response identity + nil error preserved.
	resp, err := timing(okNext)(context.Background(), connect.NewRequest(&emptypb.Empty{}))
	if err != nil {
		t.Fatalf("success path returned error: %v", err)
	}
	if resp != okResp {
		t.Fatal("success path did not pass the handler response through unchanged")
	}

	// Error path: error preserved (same code), nil response.
	resp, err = timing(errNext)(context.Background(), connect.NewRequest(&emptypb.Empty{}))
	if resp != nil {
		t.Fatal("error path should return a nil response")
	}
	if err == nil || connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("error path lost the connect error: %v", err)
	}

	if got := testutil.ToFloat64(metrics.RPCInFlight); got != inFlightBefore {
		t.Fatalf("in-flight not balanced: before=%v after=%v", inFlightBefore, got)
	}
}

// A panicking handler must still be observed (code="panic"), still decrement
// in-flight, and re-propagate the original panic unchanged — the exact gap the
// deferred observe closes (connect does not recover panics without WithRecover).
func TestUnaryTimingInterceptor_PanicIsObservedAndRepropagates(t *testing.T) {
	timing := metrics.UnaryTimingInterceptor()
	inFlightBefore := testutil.ToFloat64(metrics.RPCInFlight)
	before := histSampleCount(t, "unknown", "panic")

	panicNext := connect.UnaryFunc(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		panic("kaboom")
	})

	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("panic did not re-propagate through the interceptor")
			}
		}()
		_, _ = timing(panicNext)(context.Background(), connect.NewRequest(&emptypb.Empty{}))
	}()

	if got := histSampleCount(t, "unknown", "panic"); got != before+1 {
		t.Fatalf("panic not recorded in RPCDuration: before=%d after=%d", before, got)
	}
	if got := testutil.ToFloat64(metrics.RPCInFlight); got != inFlightBefore {
		t.Fatalf("in-flight not decremented after panic: before=%v after=%v", inFlightBefore, got)
	}
}

// histSampleCount returns the number of memba_rpc_duration_seconds observations
// recorded for the given {procedure,code} label set on the default registry.
func histSampleCount(t *testing.T, procedure, code string) uint64 {
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

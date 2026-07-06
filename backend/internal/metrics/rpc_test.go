package metrics_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	"google.golang.org/protobuf/types/known/emptypb"
)

// The interceptor must be transparent: the wrapped handler's response and error
// pass through byte-for-byte, and a duration series is recorded for the call's
// result code. It must never alter behavior — it's pure observation.
func TestUnaryTimingInterceptor_PassesThroughAndObserves(t *testing.T) {
	timing := metrics.UnaryTimingInterceptor()

	sentinel := errors.New("boom")
	okResp := connect.NewResponse(&emptypb.Empty{})

	okNext := connect.UnaryFunc(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return okResp, nil
	})
	errNext := connect.UnaryFunc(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, connect.NewError(connect.CodeInternal, sentinel)
	})

	before := testutil.CollectAndCount(metrics.RPCDuration)

	// Success path: response identity + nil error preserved.
	resp, err := timing(okNext)(context.Background(), connect.NewRequest(&emptypb.Empty{}))
	if err != nil {
		t.Fatalf("success path returned error: %v", err)
	}
	if resp != okResp {
		t.Fatal("success path did not pass the handler response through unchanged")
	}

	// Error path: error preserved (same code + underlying), nil response.
	resp, err = timing(errNext)(context.Background(), connect.NewRequest(&emptypb.Empty{}))
	if resp != nil {
		t.Fatal("error path should return a nil response")
	}
	if err == nil || connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("error path lost the connect error: %v", err)
	}

	after := testutil.CollectAndCount(metrics.RPCDuration)
	if after <= before {
		t.Fatalf("expected new memba_rpc_duration_seconds series (ok + internal), before=%d after=%d", before, after)
	}
}

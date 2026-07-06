package metrics

import (
	"context"
	"time"

	"connectrpc.com/connect"
)

// codeFor maps a handler result to the RPCDuration "code" label: "ok" for a nil
// error, otherwise the connect.Code string (connect.CodeOf returns CodeUnknown —
// "unknown" — for a non-connect error).
func codeFor(err error) string {
	if err == nil {
		return "ok"
	}
	return connect.CodeOf(err).String()
}

// observeRPC records one RPCDuration sample. Split out so the real
// procedure-labeling path is unit-testable without a fully-populated connect.Spec
// (which connect only sets on the wire path).
func observeRPC(procedure, code string, elapsed time.Duration) {
	if procedure == "" {
		procedure = "unknown"
	}
	RPCDuration.WithLabelValues(procedure, code).Observe(elapsed.Seconds())
}

// UnaryTimingInterceptor returns a Connect interceptor that records each unary
// RPC's handler latency into RPCDuration (labeled by procedure and result code)
// and tracks concurrency in RPCInFlight. It is pure observation: it returns the
// handler's response and error unchanged and never short-circuits or rewrites a
// result. The observe + in-flight decrement run in a deferred closure, so a
// handler that PANICS is still counted (as code="panic") and still decrements
// in-flight before the panic re-propagates unchanged — connect does not recover
// panics unless WithRecover is set, so without the defer a panicking RPC would
// vanish from the histogram entirely. Streaming RPCs pass through untouched
// (unary-only interceptor; Memba's RPCs are all unary).
func UnaryTimingInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (res connect.AnyResponse, err error) {
			start := time.Now()
			RPCInFlight.Inc()
			defer func() {
				RPCInFlight.Dec()
				if r := recover(); r != nil {
					observeRPC(req.Spec().Procedure, "panic", time.Since(start))
					panic(r) // preserve original behavior — do not swallow
				}
				observeRPC(req.Spec().Procedure, codeFor(err), time.Since(start))
			}()

			res, err = next(ctx, req)
			return res, err
		}
	})
}

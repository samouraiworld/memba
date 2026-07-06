package metrics

import (
	"context"
	"time"

	"connectrpc.com/connect"
)

// UnaryTimingInterceptor returns a Connect interceptor that records every unary
// RPC's handler latency into RPCDuration, labeled by procedure and result code.
// It is pure observation: it calls the next handler and returns its response and
// error unchanged — it never short-circuits, retries, or rewrites a result. Wire
// it via connect.WithInterceptors in cmd/memba. Streaming RPCs pass through
// untouched (this is a unary-only interceptor; Memba's RPCs are all unary).
func UnaryTimingInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			res, err := next(ctx, req)

			code := "ok"
			if err != nil {
				code = connect.CodeOf(err).String()
			}
			procedure := req.Spec().Procedure
			if procedure == "" {
				procedure = "unknown"
			}
			RPCDuration.WithLabelValues(procedure, code).Observe(time.Since(start).Seconds())

			return res, err
		}
	})
}

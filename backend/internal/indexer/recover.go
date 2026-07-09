package indexer

import (
	"log/slog"
	"runtime/debug"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// runRecovered executes one indexer cycle and converts a panic into a logged
// error plus a metric increment. The indexers run in-process with the RPC
// server, so a panic inside a tail/parse cycle must never take down API
// serving — the cycle is skipped and the loop retries on its next tick.
func runRecovered(log *slog.Logger, name string, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			metrics.IndexerCyclePanics.WithLabelValues(name).Inc()
			log.Error("indexer cycle panicked; cycle skipped, loop continues",
				"indexer", name, "panic", r, "stack", string(debug.Stack()))
		}
	}()
	fn()
}

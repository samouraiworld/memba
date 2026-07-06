package metrics

import (
	"database/sql"

	"github.com/prometheus/client_golang/prometheus"
)

// DBStatsMetricCount is the number of metrics RegisterDBStats registers (3 pool
// gauges + 2 cumulative counters). Kept in sync with the collectors below so the
// test can assert the full set is exposed.
const DBStatsMetricCount = 5

// RegisterDBStats exposes the database/sql connection-pool stats as read-only
// Prometheus metrics on the given registerer. The pool-status fields
// (OpenConnections/InUse/Idle) are instantaneous → gauges; WaitCount/WaitDuration
// are documented by database/sql as monotonic cumulative totals → COUNTERS
// (CounterFunc wraps an externally-maintained monotonic value), so rate()/
// increase() are valid and Prometheus applies counter-reset correction across the
// frequent Fly redeploys. On SQLite with MaxOpenConns(1) the pool is a
// single-writer bottleneck, so rate(memba_db_wait_duration_seconds_total) — the
// fraction of wall-clock time blocked on the DB lock — is the key saturation
// signal (alert as it climbs toward 1). Only reads db.Stats(); never touches data
// or schema, so it is safe anywhere. Called once from cmd/memba with the default
// registerer; tests pass a private registry.
func RegisterDBStats(reg prometheus.Registerer, db *sql.DB) {
	reg.MustRegister(
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_db_connections_open",
			Help: "Open database connections (in-use + idle).",
		}, func() float64 { return float64(db.Stats().OpenConnections) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_db_connections_in_use",
			Help: "Database connections currently in use.",
		}, func() float64 { return float64(db.Stats().InUse) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_db_connections_idle",
			Help: "Idle database connections in the pool.",
		}, func() float64 { return float64(db.Stats().Idle) }),
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "memba_db_wait_count_total",
			Help: "Cumulative number of connection waits (goroutines that blocked on the pool).",
		}, func() float64 { return float64(db.Stats().WaitCount) }),
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "memba_db_wait_duration_seconds_total",
			Help: "Cumulative time blocked waiting for a database connection; rate() is the single-writer contention signal.",
		}, func() float64 { return db.Stats().WaitDuration.Seconds() }),
	)
}

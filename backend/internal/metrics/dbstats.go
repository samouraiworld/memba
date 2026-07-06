package metrics

import (
	"database/sql"

	"github.com/prometheus/client_golang/prometheus"
)

// DBStatsGaugeCount is the number of gauges RegisterDBStats registers. Kept in
// sync with the collectors below so the test can assert the full set is exposed.
const DBStatsGaugeCount = 5

// RegisterDBStats exposes the database/sql connection-pool stats as read-only
// Prometheus gauges on the given registerer. On SQLite with MaxOpenConns(1) the
// pool is a single-writer bottleneck, so wait_count / wait_duration are the real
// contention signal (a climbing wait_duration means RPCs are queuing on the DB
// lock). It only reads db.Stats() — it never touches the data or the schema, so
// it is safe to enable anywhere. Called once from cmd/memba with the default
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
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_db_wait_count",
			Help: "Total number of connection waits (goroutines blocked on the pool).",
		}, func() float64 { return float64(db.Stats().WaitCount) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_db_wait_duration_seconds",
			Help: "Total time blocked waiting for a database connection (single-writer contention signal).",
		}, func() float64 { return db.Stats().WaitDuration.Seconds() }),
	)
}

package metrics_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	_ "modernc.org/sqlite"
)

var wantDBStatsNames = []string{
	"memba_db_connections_open",
	"memba_db_connections_in_use",
	"memba_db_connections_idle",
	"memba_db_wait_count_total",
	"memba_db_wait_duration_seconds_total",
}

// RegisterDBStats must register exactly the expected read-only pool metrics on the
// given registerer, and their closures must reflect the live db.Stats() (not a
// stale/wrong field). A private registry keeps the process-wide default registry
// (and the other tests) untouched.
func TestRegisterDBStats(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "stats.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() { _ = database.Close() }()

	reg := prometheus.NewPedanticRegistry()
	metrics.RegisterDBStats(reg, database)

	// Full set present, by exact name (catches a rename/dup/missing metric).
	if n, err := testutil.GatherAndCount(reg); err != nil {
		t.Fatalf("gather: %v", err)
	} else if n != metrics.DBStatsMetricCount {
		t.Fatalf("expected %d db metrics, got %d", metrics.DBStatsMetricCount, n)
	}
	for _, name := range wantDBStatsNames {
		if c, err := testutil.GatherAndCount(reg, name); err != nil || c != 1 {
			t.Fatalf("metric %q not registered exactly once (count=%d, err=%v)", name, c, err)
		}
	}
	if len(wantDBStatsNames) != metrics.DBStatsMetricCount {
		t.Fatalf("wantDBStatsNames (%d) out of sync with DBStatsMetricCount (%d)", len(wantDBStatsNames), metrics.DBStatsMetricCount)
	}

	// The closures must read the LIVE pool: hold the single connection (Open sets
	// MaxOpenConns(1)) and the gauges must reflect it — this is the assertion that
	// would catch a closure wired to the wrong db.Stats() field.
	conn, err := database.Conn(context.Background())
	if err != nil {
		t.Fatalf("grab conn: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if v := metricValue(t, reg, "memba_db_connections_in_use"); v < 1 {
		t.Fatalf("expected in_use >= 1 while holding a connection, got %v", v)
	}
	if v := metricValue(t, reg, "memba_db_connections_open"); v < 1 {
		t.Fatalf("expected open >= 1, got %v", v)
	}
}

// metricValue gathers reg and returns the first sample value of the named
// gauge/counter metric, failing if absent.
func metricValue(t *testing.T, g prometheus.Gatherer, name string) float64 {
	t.Helper()
	fams, err := g.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	for _, f := range fams {
		if f.GetName() != name {
			continue
		}
		m := f.GetMetric()
		if len(m) == 0 {
			t.Fatalf("metric %q has no samples", name)
		}
		switch {
		case m[0].Gauge != nil:
			return m[0].Gauge.GetValue()
		case m[0].Counter != nil:
			return m[0].Counter.GetValue()
		}
	}
	t.Fatalf("metric %q not found", name)
	return 0
}

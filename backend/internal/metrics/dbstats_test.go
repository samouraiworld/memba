package metrics_test

import (
	"path/filepath"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	_ "modernc.org/sqlite"
)

// RegisterDBStats must register a fixed set of read-only pool gauges on the given
// registerer and collect them (i.e. call db.Stats()) without error or panic — it
// never mutates the DB. Using a private registry keeps the process-wide default
// registry (and the other tests) untouched.
func TestRegisterDBStats(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "stats.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	reg := prometheus.NewPedanticRegistry()
	metrics.RegisterDBStats(reg, database)

	n, err := testutil.GatherAndCount(reg)
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	if n != metrics.DBStatsGaugeCount {
		t.Fatalf("expected %d db-pool gauges, got %d", metrics.DBStatsGaugeCount, n)
	}
}

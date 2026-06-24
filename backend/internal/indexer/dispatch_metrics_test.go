package indexer

import (
	"context"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// A skipped malformed Sale must bump the dropped-event counter so operators can
// alert on schema drift (the slog.Warn alone is not alertable).
func TestApplySale_Malformed_IncrementsDroppedMetric(t *testing.T) {
	metrics.NFTEventDropped.Reset()
	db := openTestDB(t)
	ctx := context.Background()

	bad := validSaleAttrs()
	bad["via"] = "bogus" // malformed → skipped
	must(t, dispatchEvent(ctx, db, saleEvt(720, bad), ""))
	if got := testutil.ToFloat64(metrics.NFTEventDropped.WithLabelValues("Sale")); got != 1 {
		t.Fatalf("dropped counter after malformed Sale = %v, want 1", got)
	}

	// A well-formed Sale must NOT bump the drop counter.
	must(t, dispatchEvent(ctx, db, saleEvt(721, validSaleAttrs()), ""))
	if got := testutil.ToFloat64(metrics.NFTEventDropped.WithLabelValues("Sale")); got != 1 {
		t.Fatalf("valid Sale bumped the drop counter: %v, want still 1", got)
	}
}

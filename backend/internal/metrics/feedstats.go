package metrics

import (
	"context"
	"database/sql"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// FeedAbuseMetricCount is the number of metrics RegisterFeedAbuseStats registers.
// Kept in sync with the collectors below so the test can assert the full set
// (see wantFeedAbuseNames).
const FeedAbuseMetricCount = 4

// feedScrapeTimeout bounds each on-scrape COUNT so a slow scan can never wedge a
// Prometheus scrape of /metrics.
const feedScrapeTimeout = 2 * time.Second

// scalarCount runs a single-value COUNT and returns 0 on any error or NULL — a
// metric read must never fail the whole /metrics response.
func scalarCount(db *sql.DB, query string) float64 {
	ctx, cancel := context.WithTimeout(context.Background(), feedScrapeTimeout)
	defer cancel()
	var n sql.NullInt64
	if err := db.QueryRowContext(ctx, query).Scan(&n); err != nil {
		return 0
	}
	return float64(n.Int64)
}

// RegisterFeedAbuseStats exposes feed abuse-signal gauges on the given
// registerer: recent flag volume, unique flaggers, flag-threshold auto-hides, and
// posting authors. They read the feed projection ON SCRAPE and never write, so
// they are safe anywhere; they ride the existing METRICS_BEARER-gated /metrics
// endpoint (no new surface).
//
// Sources: feed_raw_events (wall-clock `ingest_ts` — fine for a live "recent
// activity" abuse gauge; note it re-stamps on the rare rebuild-from-raw, so it is
// not deterministic across a rebuild) for flag/auto-hide counts, and feed_posts
// (deterministic block-time `block_ts`) for posting authors. A low
// unique_flaggers_per_day against a high flags_per_hour is the brigade signal.
//
// Called once from cmd/memba with the default registerer; tests pass a private
// registry.
func RegisterFeedAbuseStats(reg prometheus.Registerer, db *sql.DB) {
	reg.MustRegister(
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_feed_flags_per_hour",
			Help: "PostFlagged events ingested in the last hour (feed abuse / brigade signal).",
		}, func() float64 {
			return scalarCount(db, `SELECT COUNT(*) FROM feed_raw_events
				WHERE event_name = 'PostFlagged' AND ingest_ts >= datetime('now','-1 hour')`)
		}),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_feed_unique_flaggers_per_day",
			Help: "Distinct flagger addresses in the last day; low count with high flags/hour = brigade.",
		}, func() float64 {
			return scalarCount(db, `SELECT COUNT(DISTINCT json_extract(attrs_json,'$.flagger'))
				FROM feed_raw_events
				WHERE event_name = 'PostFlagged'
				  AND ingest_ts >= datetime('now','-1 day')
				  AND json_extract(attrs_json,'$.flagger') IS NOT NULL`)
		}),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_feed_auto_hides_per_day",
			Help: "PostAutoHidden events (flag-threshold auto-hides) in the last day.",
		}, func() float64 {
			return scalarCount(db, `SELECT COUNT(*) FROM feed_raw_events
				WHERE event_name = 'PostAutoHidden' AND ingest_ts >= datetime('now','-1 day')`)
		}),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "memba_feed_posting_authors_per_hour",
			Help: "Distinct authors who posted a live post in the last hour (deterministic via block_ts).",
		}, func() float64 {
			return scalarCount(db, `SELECT COUNT(DISTINCT author) FROM feed_posts
				WHERE block_ts >= (strftime('%s','now') - 3600) AND deleted = 0`)
		}),
	)
}

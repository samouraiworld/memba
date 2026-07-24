package metrics_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	_ "modernc.org/sqlite"
)

var wantFeedAbuseNames = []string{
	"memba_feed_flags_per_hour",
	"memba_feed_unique_flaggers_per_day",
	"memba_feed_auto_hides_per_day",
	"memba_feed_posting_authors_per_hour",
}

func feedExec(t *testing.T, database *sql.DB, q string) {
	t.Helper()
	if _, err := database.Exec(q); err != nil {
		t.Fatalf("exec: %v\n%s", err, q)
	}
}

// RegisterFeedAbuseStats must register exactly the expected read-only gauges, and
// their on-scrape queries must honor the 1h / 1d windows against the source rows.
func TestRegisterFeedAbuseStats(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "feed.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// PostFlagged: 2 within the last hour (g1a, g1b), 1 within the day only (g1c),
	// 1 outside the day (g1d) → flags/hour = 2, unique flaggers/day = 3.
	// PostAutoHidden: 1 within the day, 1 outside → auto_hides/day = 1.
	feedExec(t, database, `INSERT INTO feed_raw_events
		(event_block,event_tx_index,event_index,pkg_path,event_name,attrs_json,block_hash,ingest_ts) VALUES
		(1,0,0,'p','PostFlagged','{"flagger":"g1a"}','h', datetime('now','-30 minutes')),
		(2,0,0,'p','PostFlagged','{"flagger":"g1b"}','h', datetime('now','-50 minutes')),
		(3,0,0,'p','PostFlagged','{"flagger":"g1c"}','h', datetime('now','-5 hours')),
		(4,0,0,'p','PostFlagged','{"flagger":"g1d"}','h', datetime('now','-2 days')),
		(5,0,0,'p','PostAutoHidden','{}','h', datetime('now','-3 hours')),
		(6,0,0,'p','PostAutoHidden','{}','h', datetime('now','-2 days'))`)

	// feed_posts: g1x + g1y within the hour (g1x twice → distinct 2), g1z outside
	// the hour, g1w within but deleted → posting_authors/hour = 2.
	feedExec(t, database, `INSERT INTO feed_posts
		(post_id,author,body,reply_to,block_h,block_ts,created_event_block,deleted) VALUES
		(1,'g1x','',0,10,(strftime('%s','now')-1800),10,0),
		(2,'g1y','',0,11,(strftime('%s','now')-1800),11,0),
		(3,'g1x','',0,12,(strftime('%s','now')-1200),12,0),
		(4,'g1z','',0,13,(strftime('%s','now')-7200),13,0),
		(5,'g1w','',0,14,(strftime('%s','now')-600),14,1)`)

	reg := prometheus.NewPedanticRegistry()
	metrics.RegisterFeedAbuseStats(reg, database)

	if n, err := testutil.GatherAndCount(reg); err != nil {
		t.Fatalf("gather: %v", err)
	} else if n != metrics.FeedAbuseMetricCount {
		t.Fatalf("expected %d feed-abuse metrics, got %d", metrics.FeedAbuseMetricCount, n)
	}
	for _, name := range wantFeedAbuseNames {
		if c, err := testutil.GatherAndCount(reg, name); err != nil || c != 1 {
			t.Fatalf("metric %q not registered exactly once (count=%d, err=%v)", name, c, err)
		}
	}
	if len(wantFeedAbuseNames) != metrics.FeedAbuseMetricCount {
		t.Fatalf("wantFeedAbuseNames (%d) out of sync with FeedAbuseMetricCount (%d)", len(wantFeedAbuseNames), metrics.FeedAbuseMetricCount)
	}

	for _, tc := range []struct {
		name string
		want float64
	}{
		{"memba_feed_flags_per_hour", 2},
		{"memba_feed_unique_flaggers_per_day", 3},
		{"memba_feed_auto_hides_per_day", 1},
		{"memba_feed_posting_authors_per_hour", 2},
	} {
		if v := metricValue(t, reg, tc.name); v != tc.want {
			t.Fatalf("%s = %v, want %v", tc.name, v, tc.want)
		}
	}
}

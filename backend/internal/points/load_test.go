package points

import (
	"context"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

func TestLoadConfirmedSales_RespectsWatermark(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Two Sale events at heights 100 and 300.
	for _, h := range []int64{100, 300} {
		_, _ = database.ExecContext(ctx, `INSERT INTO nft_raw_events
			(event_block,event_tx_index,event_index,pkg_path,event_name,schema_version,attrs_json,ingest_ts)
			VALUES (?,0,0,'gno.land/r/x','Sale','1',?,CURRENT_TIMESTAMP)`,
			h, `{"via":"buy","seller":"s","buyer":"b","price":"100","royalty":"10"}`)
	}
	// Watermark at 200 → only the height-100 sale is confirmed.
	got, err := LoadConfirmedSales(ctx, database, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Block != 100 {
		t.Fatalf("loaded %d sales, want 1 at block 100", len(got))
	}
}

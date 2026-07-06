package blockparty_test

import (
	"testing"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/db"
)

func TestMigration_BlockPartyTablesExist(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, tbl := range []string{"blockparty_challenges", "blockparty_scores", "blockparty_streaks"} {
		var name string
		err := database.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&name)
		if err != nil {
			t.Fatalf("table %s missing: %v", tbl, err)
		}
	}
}

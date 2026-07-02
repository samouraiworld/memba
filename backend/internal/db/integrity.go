package db

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
)

// IntegrityCheck runs SQLite's PRAGMA integrity_check against the database at
// path and returns an error unless it reports exactly "ok".
//
// Used by the container entrypoint (start.sh → `memba integrity-check`) BEFORE
// Litestream starts replicating: a present-but-corrupt /data/memba.db used to
// be trusted as-is ("Database already exists, skipping restore") and its
// corruption replicated forward into the S3 replica, aging out the last good
// snapshot within the retention window. The file must exist — SQLite would
// otherwise CREATE an empty database and report it healthy.
func IntegrityCheck(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("integrity check: %w", err)
	}

	// mode=ro so the check can never create or mutate anything.
	database, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return fmt.Errorf("integrity check open: %w", err)
	}
	defer func() { _ = database.Close() }()
	database.SetMaxOpenConns(1)

	rows, err := database.Query("PRAGMA integrity_check")
	if err != nil {
		return fmt.Errorf("integrity check query: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var problems []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return fmt.Errorf("integrity check scan: %w", err)
		}
		if line != "ok" {
			problems = append(problems, line)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("integrity check rows: %w", err)
	}
	if len(problems) > 0 {
		return fmt.Errorf("integrity check failed: %s", strings.Join(problems, "; "))
	}
	return nil
}

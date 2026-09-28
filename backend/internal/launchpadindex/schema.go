package launchpadindex

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
)

//go:embed schema/001_store.sql
var storeSchemaV1 string

//go:embed schema/002_block_num_txs.sql
var storeSchemaV2 string

var ErrStoreSchema = errors.New("launchpad store schema mismatch")

// MigrateStore creates only package-owned launchpad_* tables in the caller's
// existing SQLite database. The file-backed production DB is already covered
// by Memba's backup path. This function is deliberately not wired to startup.
func MigrateStore(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrStoreSchema
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin launchpad schema migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS launchpad_schema_versions (
		version INTEGER PRIMARY KEY CHECK (version > 0),
		checksum TEXT NOT NULL CHECK (length(checksum) = 64)
	)`); err != nil {
		return fmt.Errorf("create launchpad schema tracker: %w", err)
	}
	migrations := []string{storeSchemaV1, storeSchemaV2}
	rows, err := tx.QueryContext(ctx, `SELECT version, checksum FROM launchpad_schema_versions ORDER BY version`)
	if err != nil {
		return fmt.Errorf("read launchpad schema version: %w", err)
	}
	count := 0
	for rows.Next() {
		var version int
		var checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			_ = rows.Close()
			return err
		}
		count++
		if count > len(migrations) || version != count || checksum != schemaChecksum(migrations[count-1]) {
			_ = rows.Close()
			return ErrStoreSchema
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for version := count + 1; version <= len(migrations); version++ {
		if version == 2 {
			var existingBlocks int64
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM launchpad_blocks`).Scan(&existingBlocks); err != nil {
				return fmt.Errorf("check launchpad v1 journal: %w", err)
			}
			if existingBlocks != 0 {
				return fmt.Errorf("launchpad v1 blocks require verified replay before v2: %w", ErrStoreSchema)
			}
		}
		if _, err := tx.ExecContext(ctx, migrations[version-1]); err != nil {
			return fmt.Errorf("apply launchpad schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO launchpad_schema_versions(version, checksum) VALUES (?, ?)`,
			version, schemaChecksum(migrations[version-1])); err != nil {
			return fmt.Errorf("record launchpad schema version %d: %w", version, err)
		}
	}
	return tx.Commit()
}

func schemaChecksum(source string) string {
	hash := sha256.Sum256([]byte(source))
	return hex.EncodeToString(hash[:])
}

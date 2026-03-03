package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	defaultBackupInterval = 24 * time.Hour
	maxBackups            = 7
)

// StartBackupSchedule runs a goroutine that creates daily SQLite backups
// using VACUUM INTO (WAL-safe, no lock on live DB). Keeps the last 7 backups.
// Stops cleanly on context cancellation.
func StartBackupSchedule(ctx context.Context, database *sql.DB, dbPath string, logger *slog.Logger, interval time.Duration) {
	if interval <= 0 {
		interval = defaultBackupInterval
	}

	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")

	go func() {
		// Create backup directory if needed
		if err := os.MkdirAll(backupDir, 0o750); err != nil {
			logger.Error("backup: failed to create directory", "path", backupDir, "error", err)
			return
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		logger.Info("backup: scheduler started", "interval", interval, "dir", backupDir, "retention", maxBackups)

		for {
			select {
			case <-ctx.Done():
				logger.Info("backup: scheduler stopped")
				return
			case <-ticker.C:
				runBackup(database, backupDir, logger)
			}
		}
	}()
}

func runBackup(database *sql.DB, backupDir string, logger *slog.Logger) {
	filename := fmt.Sprintf("memba_%s.db", time.Now().UTC().Format("20060102_150405"))
	dest := filepath.Join(backupDir, filename)

	start := time.Now()

	// VACUUM INTO creates a clean, compacted copy without locking the live DB.
	_, err := database.Exec("VACUUM INTO ?", dest)
	if err != nil {
		logger.Error("backup: VACUUM INTO failed", "dest", dest, "error", err)
		return
	}

	// Log file size
	var sizeBytes int64
	if info, err := os.Stat(dest); err == nil {
		sizeBytes = info.Size()
	}

	logger.Info("backup: success",
		"file", filename,
		"size_mb", fmt.Sprintf("%.1f", float64(sizeBytes)/1024/1024),
		"duration_ms", time.Since(start).Milliseconds(),
	)

	// Retention: keep only the last maxBackups files
	pruneBackups(backupDir, logger)
}

func pruneBackups(backupDir string, logger *slog.Logger) {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		logger.Error("backup: failed to list backups", "error", err)
		return
	}

	// Filter to .db files only, sort by name (timestamp-based, so alphabetical = chronological)
	var backups []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".db" {
			backups = append(backups, e.Name())
		}
	}
	sort.Strings(backups)

	// Delete oldest if over limit
	for len(backups) > maxBackups {
		oldest := filepath.Join(backupDir, backups[0])
		if err := os.Remove(oldest); err != nil {
			logger.Error("backup: failed to prune", "file", backups[0], "error", err)
		} else {
			logger.Info("backup: pruned old backup", "file", backups[0])
		}
		backups = backups[1:]
	}
}

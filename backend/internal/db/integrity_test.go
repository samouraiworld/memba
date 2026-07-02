package db

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIntegrityCheck_ValidDatabase_OK(t *testing.T) {
	path := filepath.Join(t.TempDir(), "good.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal("open:", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	if _, err := database.Exec(`INSERT INTO quest_completions (address, quest_id, completed_at) VALUES ('g1a', 'connect-wallet', '2026-07-02T00:00:00Z')`); err != nil {
		t.Fatal("insert:", err)
	}
	if err := database.Close(); err != nil {
		t.Fatal("close:", err)
	}

	if err := IntegrityCheck(path); err != nil {
		t.Fatalf("expected valid database to pass, got %v", err)
	}
}

func TestIntegrityCheck_GarbageFile_Fails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.db")
	// A file that is not SQLite at all must fail, not be silently accepted.
	if err := os.WriteFile(path, []byte("this is not a sqlite database, just bytes"), 0o600); err != nil {
		t.Fatal("write:", err)
	}

	if err := IntegrityCheck(path); err == nil {
		t.Fatal("expected garbage file to fail integrity check")
	}
}

func TestIntegrityCheck_CorruptedPage_Fails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "torn.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal("open:", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	if err := database.Close(); err != nil {
		t.Fatal("close:", err)
	}

	// Simulate a torn page: keep the valid 100-byte SQLite header so a naive
	// header check would still pass, but trash the b-tree content of page 1
	// (the sqlite_schema root, always in use) directly after it — this is the
	// "volume glitch corrupted a page" scenario.
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		t.Fatal("open file:", err)
	}
	junk := make([]byte, 512)
	for i := range junk {
		junk[i] = 0xAA
	}
	if _, err := f.WriteAt(junk, 100); err != nil {
		t.Fatal("write junk:", err)
	}
	if err := f.Close(); err != nil {
		t.Fatal("close file:", err)
	}

	if err := IntegrityCheck(path); err == nil {
		t.Fatal("expected corrupted page to fail integrity check")
	}
}

func TestIntegrityCheck_MissingFile_Fails(t *testing.T) {
	// A missing file must be an error, never a pass — SQLite would otherwise
	// happily CREATE an empty database and report it healthy.
	if err := IntegrityCheck(filepath.Join(t.TempDir(), "nope.db")); err == nil {
		t.Fatal("expected missing file to fail integrity check")
	}
}

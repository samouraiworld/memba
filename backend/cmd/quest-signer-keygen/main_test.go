package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fixed entropy = the realm parity vector (seed 0x01..0x20), so the printed
// pubkey is a known value and nothing random is generated in tests.
const (
	vectorSeedHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
	vectorPubHex  = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664"
)

func vectorEntropy() *bytes.Reader {
	b := make([]byte, 32)
	for i := range b {
		b[i] = byte(i + 1)
	}
	return bytes.NewReader(b)
}

func TestGenerate_WritesSeedFilePrintsOnlyPubkey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "signer.seed")
	var out bytes.Buffer
	if err := runGenerate(&out, vectorEntropy(), path, " gnoland-1 "); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), vectorSeedHex) {
		t.Fatal("the seed must never be printed")
	}
	for _, want := range []string{vectorPubHex, "QUEST_SIGNER_CHAIN_ID=gnoland-1"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("output missing %q:\n%s", want, out.String())
		}
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != vectorSeedHex+"\n" {
		t.Fatalf("seed file = %q", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("seed file mode = %o, want 600", info.Mode().Perm())
	}

	var derived bytes.Buffer
	if err := runDerive(&derived, path); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(derived.String(), vectorPubHex) || strings.Contains(derived.String(), vectorSeedHex) {
		t.Fatalf("derive must print the same pubkey and no seed:\n%s", derived.String())
	}
}

func TestGenerate_RefusesOverwriteAndMissingChain(t *testing.T) {
	path := filepath.Join(t.TempDir(), "signer.seed")
	if err := os.WriteFile(path, []byte("existing\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := runGenerate(&bytes.Buffer{}, vectorEntropy(), path, "gnoland-1"); err == nil {
		t.Fatal("must refuse to overwrite an existing key file")
	}
	if got, _ := os.ReadFile(path); string(got) != "existing\n" {
		t.Fatal("existing file was modified")
	}
	fresh := filepath.Join(t.TempDir(), "fresh.seed")
	if err := runGenerate(&bytes.Buffer{}, vectorEntropy(), fresh, "  "); err == nil {
		t.Fatal("a chain binding is required")
	}
	if _, err := os.Stat(fresh); !os.IsNotExist(err) {
		t.Fatal("no file may be written without a chain binding")
	}
}

func TestDerive_BadSeedDoesNotEchoIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.seed")
	if err := os.WriteFile(path, []byte("zz"+vectorSeedHex[2:]), 0o600); err != nil {
		t.Fatal(err)
	}
	err := runDerive(&bytes.Buffer{}, path)
	if err == nil {
		t.Fatal("bad seed must error")
	}
	if strings.Contains(err.Error(), "U+") || strings.Contains(err.Error(), vectorSeedHex[2:12]) {
		t.Fatalf("error leaks seed bytes: %v", err)
	}
}

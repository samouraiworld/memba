// Command quest-signer-keygen is the OWNER-SIDE tool that creates the offline
// ed25519 key the backend uses to sign quest attestation vouchers (Q-05), bound
// to one chain (owner ruling O4). Run it on the owner's machine, never on Fly
// and never in CI. It writes the 32-byte seed as 64 hex chars to a NEW file
// (mode 0600, refuses to overwrite) and prints only the public key, which is
// what the publisher registers with the realm's SetSigner. The seed itself is
// never printed.
//
// Usage:
//
//	go run ./cmd/quest-signer-keygen -out ~/secure/quest-signer-gnoland-1.seed -chain gnoland-1
//	go run ./cmd/quest-signer-keygen -derive ~/secure/quest-signer-gnoland-1.seed
//
// The -derive form re-prints the public key of an existing seed file, so the
// owner can check what is on Fly against what the realm holds. Both forms derive
// the key with attestation.NewFromSeedHex, the same code the backend runs.
//
// Full procedure: docs/QUEST_ATTESTATION_RUNBOOK.md.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/samouraiworld/memba/backend/internal/attestation"
)

func main() {
	var (
		out    = flag.String("out", "", "path of the NEW seed file to create (mode 0600; refuses to overwrite)")
		chain  = flag.String("chain", "", "chain id this key is for; becomes QUEST_SIGNER_CHAIN_ID (e.g. gnoland-1)")
		derive = flag.String("derive", "", "print the public key of an existing seed file instead of generating one")
	)
	flag.Parse()

	var err error
	switch {
	case *derive != "" && *out == "":
		err = runDerive(os.Stdout, *derive)
	case *out != "" && *derive == "":
		err = runGenerate(os.Stdout, rand.Reader, *out, *chain)
	default:
		err = errors.New("pass exactly one of -out (with -chain) or -derive")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "quest-signer-keygen:", err)
		os.Exit(1)
	}
}

// runGenerate creates a fresh seed at path and prints the public key and the
// binding to w. The seed goes only to the file.
func runGenerate(w io.Writer, entropy io.Reader, path, chain string) error {
	chain = strings.TrimSpace(chain)
	if chain == "" {
		return errors.New("-chain is required: the key is bound to exactly one chain")
	}
	seed := make([]byte, 32)
	if _, err := io.ReadFull(entropy, seed); err != nil {
		return fmt.Errorf("read entropy: %w", err)
	}
	seedHex := hex.EncodeToString(seed)
	signer, _, err := attestation.NewBoundSigner(seedHex, chain, chain)
	if err != nil {
		return err
	}
	// O_EXCL: never clobber an existing key file.
	f, err := os.OpenFile(filepath.Clean(path), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create seed file: %w", err)
	}
	if _, err := f.WriteString(seedHex + "\n"); err != nil {
		_ = f.Close()
		return fmt.Errorf("write seed file: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close seed file: %w", err)
	}
	_, err = fmt.Fprintf(w, "seed written to %s (mode 0600) — keep it offline; it goes only to Fly as MEMBA_ATTESTATION_SEED\nQUEST_SIGNER_CHAIN_ID=%s\nSetSigner pubkey (hex): %s\n",
		path, signer.ChainID(), signer.PublicKeyHex())
	return err
}

// runDerive prints the public key of the seed stored at path.
func runDerive(w io.Writer, path string) error {
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return fmt.Errorf("read seed file: %w", err)
	}
	signer, err := attestation.NewFromSeedHex(string(b))
	if err != nil {
		// Never echo err: hex decode errors quote the offending seed byte.
		return errors.New("seed file does not hold 64 hex chars")
	}
	_, err = fmt.Fprintf(w, "SetSigner pubkey (hex): %s\n", signer.PublicKeyHex())
	return err
}

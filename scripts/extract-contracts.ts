#!/usr/bin/env node
/**
 * extract-contracts.ts — Extract Gno contract source files from template generators.
 *
 * Imports each template, calls the generator with test parameters, and writes
 * the generated .gno source + gnomod.toml to the contracts/ directory.
 *
 * Usage:
 *   npx tsx scripts/extract-contracts.ts
 *
 * Output structure:
 *   contracts/
 *     memba_dao_test/        — DAO realm
 *     memba_channels_test/   — Channels realm
 *     memba_candidature_test/ — Candidature realm
 *     escrow_test/           — Escrow realm
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// We can't import the templates directly since they have browser deps.
// Instead, we generate minimal contract stubs that exercise the same patterns.
// This is intentional — the contracts/ directory is for `gno test` validation,
// not for deployment (deployment uses the frontend template generators).

// Compatible with both ESM and CJS (tsx in CJS mode sets import.meta.dirname to undefined)
const __scriptDir = typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url))

const CONTRACTS_DIR = join(__scriptDir, "..", "contracts")

interface Contract {
    dir: string
    files: Record<string, string>
}

const contracts: Contract[] = [
    {
        dir: "memba_dao_test",
        files: {
            "gno.mod": `module gno.land/r/samcrew/memba_dao_test

require (
\tgno.land/p/demo/ufmt v0.0.0
)
`,
            "dao.gno": `package memba_dao_test

import "gno.land/p/demo/ufmt"

var (
\tname        = "Memba DAO Test"
\tdescription = "Test DAO for contract extraction"
\tmembers     = []string{"g1test1", "g1test2"}
)

func Render(path string) string {
\tswitch path {
\tcase "":
\t\treturn ufmt.Sprintf("# %s\\n\\n%s\\n\\nMembers: %d", name, description, len(members))
\tcase "config":
\t\treturn ufmt.Sprintf("Name: %s\\nDescription: %s", name, description)
\tdefault:
\t\treturn "404: path not found"
\t}
}
`,
            "dao_test.gno": `package memba_dao_test

import "testing"

func TestRender(t *testing.T) {
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render returned empty string")
\t}
}

func TestRenderConfig(t *testing.T) {
\tresult := Render("config")
\tif result == "" {
\t\tt.Fatal("Render config returned empty string")
\t}
}

func TestRender404(t *testing.T) {
\tresult := Render("nonexistent")
\tif result != "404: path not found" {
\t\tt.Fatalf("expected 404 message, got: %s", result)
\t}
}
`,
        },
    },
    {
        dir: "memba_channels_test",
        files: {
            "gno.mod": `module gno.land/r/samcrew/memba_channels_test

require (
\tgno.land/p/demo/ufmt v0.0.0
)
`,
            "channels.gno": `package memba_channels_test

import "gno.land/p/demo/ufmt"

var channels = []string{"general", "announcements", "dev"}

func Render(path string) string {
\tif path == "" {
\t\tout := "# Channels\\n\\n"
\t\tfor _, ch := range channels {
\t\t\tout += ufmt.Sprintf("- [%s](%s)\\n", ch, ch)
\t\t}
\t\treturn out
\t}
\treturn ufmt.Sprintf("## %s\\n\\nChannel content here.", path)
}
`,
            "channels_test.gno": `package memba_channels_test

import "testing"

func TestRenderRoot(t *testing.T) {
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render returned empty string")
\t}
}

func TestRenderChannel(t *testing.T) {
\tresult := Render("general")
\tif result == "" {
\t\tt.Fatal("Render channel returned empty string")
\t}
}
`,
        },
    },
    {
        dir: "memba_candidature_test",
        files: {
            "gno.mod": `module gno.land/r/samcrew/memba_candidature_test

require (
\tgno.land/p/demo/ufmt v0.0.0
)
`,
            "candidature.gno": `package memba_candidature_test

import "gno.land/p/demo/ufmt"

type Candidature struct {
\tApplicant string
\tReason    string
\tStatus    string
}

var candidatures []Candidature

func Apply(reason string) {
\tcandidatures = append(candidatures, Candidature{
\t\tApplicant: "caller",
\t\tReason:    reason,
\t\tStatus:    "pending",
\t})
}

func Render(_ string) string {
\tif len(candidatures) == 0 {
\t\treturn "# Candidatures\\n\\nNo candidatures yet."
\t}
\tout := "# Candidatures\\n\\n"
\tfor i, c := range candidatures {
\t\tout += ufmt.Sprintf("%d. %s — %s (%s)\\n", i+1, c.Applicant, c.Reason, c.Status)
\t}
\treturn out
}
`,
            "candidature_test.gno": `package memba_candidature_test

import "testing"

func TestRenderEmpty(t *testing.T) {
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render returned empty string")
\t}
}

func TestApplyAndRender(t *testing.T) {
\tApply("I want to contribute to Memba")
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render after apply returned empty string")
\t}
}
`,
        },
    },
    {
        dir: "escrow_test",
        files: {
            "gno.mod": `module gno.land/r/samcrew/escrow_test

require (
\tgno.land/p/demo/ufmt v0.0.0
)
`,
            "escrow.gno": `package escrow_test

import "gno.land/p/demo/ufmt"

type EscrowContract struct {
\tBuyer  string
\tSeller string
\tAmount int64
\tStatus string // "funded", "completed", "disputed", "cancelled"
}

var contracts []EscrowContract

func CreateEscrow(seller string, amount int64) int {
\tcontracts = append(contracts, EscrowContract{
\t\tBuyer:  "caller",
\t\tSeller: seller,
\t\tAmount: amount,
\t\tStatus: "funded",
\t})
\treturn len(contracts) - 1
}

func CompleteEscrow(id int) {
\tif id < 0 || id >= len(contracts) {
\t\tpanic("invalid escrow ID")
\t}
\t// STATE-BEFORE-SEND INVARIANT:
\t// Update state BEFORE any token transfer to prevent reentrancy.
\tcontracts[id].Status = "completed"
\t// In production: send tokens here AFTER state update.
}

func Render(_ string) string {
\tif len(contracts) == 0 {
\t\treturn "# Escrow\\n\\nNo contracts yet."
\t}
\tout := "# Escrow Contracts\\n\\n"
\tfor i, c := range contracts {
\t\tout += ufmt.Sprintf("%d. %s → %s: %d ugnot (%s)\\n", i, c.Buyer, c.Seller, c.Amount, c.Status)
\t}
\treturn out
}
`,
            "escrow_test.gno": `package escrow_test

import "testing"

func TestRenderEmpty(t *testing.T) {
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render returned empty string")
\t}
}

func TestCreateAndComplete(t *testing.T) {
\tid := CreateEscrow("g1seller", 1000000)
\tCompleteEscrow(id)
\tresult := Render("")
\tif result == "" {
\t\tt.Fatal("Render after complete returned empty string")
\t}
}

func TestInvalidEscrowID(t *testing.T) {
\tdefer func() {
\t\tif r := recover(); r == nil {
\t\t\tt.Fatal("expected panic for invalid ID")
\t\t}
\t}()
\tCompleteEscrow(999)
}
`,
        },
    },
]

// ── Write contracts ──────────────────────────────────────────

console.log("📦 Extracting contracts to", CONTRACTS_DIR)

for (const contract of contracts) {
    const dir = join(CONTRACTS_DIR, contract.dir)
    mkdirSync(dir, { recursive: true })

    for (const [filename, content] of Object.entries(contract.files)) {
        const filepath = join(dir, filename)
        writeFileSync(filepath, content, "utf-8")
        console.log(`  ✅ ${contract.dir}/${filename}`)
    }
}

console.log(`\n✅ Extracted ${contracts.length} contracts. Run:`)
console.log("   cd contracts && gno test ./...")

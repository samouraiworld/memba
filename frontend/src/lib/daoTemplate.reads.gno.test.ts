/**
 * W1.4 structured-reads proof — runs the GENERATED DAO realm under the real gno
 * test machine and asserts:
 *   - GetProposalsJSON / GetMembersJSON emit well-formed JSON (the realm-side
 *     ENCODER: jsonEsc escaping + array structure), parsed here from the RAW
 *     realm output. NOTE: this does NOT exercise the qeval wire format or the
 *     frontend decoder — that end-to-end path (Go-quote → parseQevalJSON) is
 *     proven by dao/qevalJSON.test.ts, which is the regression guard for the
 *     backslash/newline double-escape bug.
 *   - the JSON keys match the snake_case shape dao/proposals.ts reads
 *   - Render("?page=2") returns the SECOND page (the old page:N never matched
 *     the frontend's ?page=N → pages 2+ silently 404'd)
 *   - the footer emits clickable [N](?page=N) links (detectMaxPage needs them)
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 in CI forbids the skip). Hermetic:
 * gno.land/p/* deps vendored from GNOROOT/examples, GNOHOME isolated.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { REQUIRE_GNO, probeToolchain, vendorGnolandDeps } from "../test/gnoToolchain"


const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

const DAO_CODE = generateDAOCode({
    name: "Reads Gate DAO",
    description: "W1.4 structured-reads fixture",
    realmPath: "gno.land/r/samcrew/gate_dao_reads",
    members: [
        { address: ALICE, power: 50, roles: ["admin", "member"] },
        { address: BOB, power: 50, roles: ["member"] },
    ],
    threshold: 60,
    roles: ["admin", "member"],
    quorum: 0,
    proposalCategories: ["governance"],
    votingPeriodBlocks: 151200,
    minExecutionDelayBlocks: 0,
})

// The test realm writes its own JSON/pagination assertions, then prints the two
// JSON blobs (delimited) to stdout so the TS side can JSON.parse them — proving
// the escaping survives a real title with a quote and a newline.
const READS_TEST_GNO = `package gate_dao_reads

import (
\t"strings"
\t"testing"
)

var alice = testing.NewUserRealm(address("${ALICE}"))

// 25 proposals → 2 pages at renderPageSize=20. One title carries a quote and a
// newline to prove jsonEsc holds.
func seed(cur realm) {
\ttesting.SetRealm(alice)
\tPropose(cross(cur), "say \\"hi\\"\\nplease", "body", "governance")
\tfor i := 0; i < 24; i++ {
\t\tPropose(cross(cur), "prop", "body", "governance")
\t}
}

func TestJSONExportsAndPagination(cur realm, t *testing.T) {
\t// Empty case first: the array encoder must yield "[]", never "" or "[,]".
\tif got := GetProposalsJSON(); got != "[]" {
\t\tt.Fatalf("empty GetProposalsJSON: want [], got %s", got)
\t}

\tseed(cur)

\tif GetAPIVersion() != "1.0" {
\t\tt.Fatalf("APIVersion: want 1.0, got %s", GetAPIVersion())
\t}

\tpj := GetProposalsJSON()
\tif !strings.HasPrefix(pj, "[{") || !strings.HasSuffix(pj, "}]") {
\t\tt.Fatalf("GetProposalsJSON not a JSON array: %s", pj[:40])
\t}
\t// The crafted title must be escaped, never raw, inside the JSON.
\tif strings.Contains(pj, "say \\"hi\\"\\nplease") {
\t\tt.Fatal("GetProposalsJSON leaked an unescaped title — JSON is corruptible")
\t}
\tif !strings.Contains(pj, "\\\\\\"hi\\\\\\"") {
\t\tt.Fatal("GetProposalsJSON did not escape the embedded quote")
\t}
\tif !strings.Contains(pj, "\\"yes_votes\\":") || !strings.Contains(pj, "\\"created_at_block\\":") {
\t\tt.Fatal("GetProposalsJSON missing expected snake_case keys")
\t}

\tmj := GetMembersJSON()
\tif !strings.Contains(mj, "\\"address\\":") || !strings.Contains(mj, "\\"roles\\":[") {
\t\tt.Fatalf("GetMembersJSON shape wrong: %s", mj)
\t}

\t// Pagination: page 1 (Render("")) and page 2 (?page=2) must differ, and the
\t// footer must carry clickable [2](?page=2) links.
\tpage1 := Render("")
\tpage2 := Render("?page=2")
\tif page1 == page2 {
\t\tt.Fatal("Render(?page=2) returned the same page as page 1 — pagination broken")
\t}
\tif strings.Contains(page2, "# Not Found") {
\t\tt.Fatal("Render(?page=2) 404'd — the ?page=N path is not handled")
\t}
\tif !strings.Contains(page1, "[2](?page=2)") {
\t\tt.Fatalf("footer missing clickable page links:\\n%s", page1)
\t}

\t// Emit both blobs for the TS side to JSON.parse.
\tprintln("PROPOSALS_JSON:" + pj)
\tprintln("MEMBERS_JSON:" + mj)
}
`

// Toolchain probe (shared, two-direction — see ../test/gnoToolchain). Catches a gno
// that is too OLD to lint interrealm-v2 AND one whose GNOROOT has drifted NEWER than
// CI's GNO_PIN; either way the reads proof below would be meaningless.
const TOOLCHAIN = probeToolchain()

it("gno toolchain is coherent when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(
            TOOLCHAIN.ok,
            `REQUIRE_GNO=1 but the gno toolchain cannot run the reads proof — ${TOOLCHAIN.message}\n${TOOLCHAIN.lines.join("\n")}`,
        ).toBe(true)
    }
})

const describeGno = TOOLCHAIN.ok ? describe : describe.skip

if (!TOOLCHAIN.ok && !REQUIRE_GNO) {
    console.warn(
        `[dao.reads] SKIPPED — ${TOOLCHAIN.message}\nThe authoritative run is CI's \`Gno Test & Lint\` job.` +
            (TOOLCHAIN.lines.length > 0 ? `\n${TOOLCHAIN.lines.join("\n")}` : ""),
    )
}

describeGno("generated DAO structured reads prove out under `gno test` (W1.4)", () => {
    let workdir: string

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-reads-"))
    })

    it("JSON exports round-trip through JSON.parse; ?page=N pagination works", () => {
        const pkgDir = join(workdir, "gate_dao_reads")
        mkdirSync(pkgDir, { recursive: true })
        writeFileSync(join(pkgDir, "gate_dao_reads.gno"), DAO_CODE)
        writeFileSync(join(pkgDir, "gate_dao_reads_test.gno"), READS_TEST_GNO)
        writeFileSync(join(pkgDir, "gnomod.toml"), `module = "gno.land/r/samcrew/gate_dao_reads"\ngno = "0.9"\n`)
        writeFileSync(join(workdir, "gnowork.toml"), "")
        vendorGnolandDeps(workdir, [DAO_CODE, READS_TEST_GNO])
        const gnohome = join(workdir, ".gnohome")
        mkdirSync(gnohome, { recursive: true })

        const res = spawnSync("gno", ["test", "-v", "./gate_dao_reads"], {
            cwd: workdir,
            encoding: "utf8",
            env: { ...process.env, GNOHOME: gnohome },
        })
        const out = `${res.stdout ?? ""}${res.stderr ?? ""}`
        expect(res.status, `gno test failed:\n${out}`).toBe(0)
        expect(out, "expected an explicit PASS").toContain("--- PASS: TestJSONExportsAndPagination")

        // The realm printed both raw blobs — parse them to prove the ENCODER
        // produces well-formed JSON. (The wire-format decode is dao/qevalJSON.test.ts.)
        const pJson = out.match(/PROPOSALS_JSON:(\[.*\])/)?.[1]
        const mJson = out.match(/MEMBERS_JSON:(\[.*\])/)?.[1]
        expect(pJson, "realm did not print PROPOSALS_JSON").toBeTruthy()
        expect(mJson, "realm did not print MEMBERS_JSON").toBeTruthy()

        const proposals = JSON.parse(pJson!)
        expect(Array.isArray(proposals)).toBe(true)
        expect(proposals.length).toBe(25)
        expect(proposals[0]).toHaveProperty("yes_votes")
        expect(proposals[0]).toHaveProperty("created_at_block")
        // The crafted title survives the round-trip intact.
        const crafted = proposals.find((p: { title: string }) => p.title.includes("hi"))
        expect(crafted.title).toBe('say "hi"\nplease')

        const members = JSON.parse(mJson!)
        expect(members.length).toBe(2)
        expect(members[0].roles).toContain("admin")
    }, 180_000)

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})

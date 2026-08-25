/**
 * Drift guard for NETWORK-PINNED CONSTANTS (Track A3.2).
 *
 * WHY THIS EXISTS. The topaz cutover's whole bug class was constants that name a
 * chain literally instead of deriving it from the environment. Each one is
 * invisible until the chain moves, and then fails quietly:
 *
 *   - `SITEMAP_NETWORK` left 27 indexed URLs pointing at retired test13, so the
 *     public sitemap and RSS advertised a dead chain (see sitemap.ts's own note).
 *   - `chainHealth`'s fallback order offered a one-click switch to a chain with
 *     no Memba realms on it.
 *   - `SNAPSHOT_NETWORK` / `FEED_INDEXED_NETWORK` silently disable a whole
 *     feature on every chain but the one named.
 *
 * The post-mortem's ask was to "add a test that fails when a new hardcoded
 * network key appears, converting a recurring class into a caught one". This is
 * that test. It has two independent teeth:
 *
 *   1. INVENTORY — no NEW network-name literal may appear in production source
 *      without being listed below. Adding one is not forbidden; adding one
 *      *silently* is. The list is the review surface.
 *
 *   2. COHERENCE — every pin marked `cutoverCritical` must name the SAME
 *      network as all the others. A chain migration that updates config.ts but
 *      forgets sitemap.ts is the exact partial-cutover failure that has bitten
 *      this repo, and it goes red here instead of in production.
 *
 * Tooth 2 deliberately compares the pins TO EACH OTHER rather than to
 * `DEFAULT_NETWORK`. `DEFAULT_NETWORK` derives from `VITE_GNO_CHAIN_ID`, which
 * differs per environment (root `.env.e2e` pins test13, CI has no `.env` at
 * all), so asserting against it would pass or fail on which machine ran it —
 * the `env-test-divergence` trap. Mutual coherence is environment-independent.
 *
 * WHAT IT CAUGHT ON ITS FIRST RUN. `MarketplaceV2Preview.tsx` defaulted its
 * route param to `"test13"` — a chain retired two migrations earlier — so a
 * param-less visit built its "sell" links for a dead network. The fix is the
 * pattern this guard exists to push: the default now reads `DEFAULT_NETWORK`,
 * which follows `VITE_GNO_CHAIN_ID`, so it cannot go stale again. That file
 * holds no literal any more and is therefore absent from the list below —
 * deriving is how an entry leaves this file.
 *
 * SCOPE. Production source only. Tests and fixtures hold ~477 such literals
 * quite legitimately (they pin a network precisely so the assertion is
 * deterministic) and are excluded wholesale; the same goes for comments, which
 * cite chain names as examples and should stay free to.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const dir = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(dir, "..")

/** Every network key/chain-id string the app has ever recognised. Keep in step
 *  with `NETWORKS` in config.ts — a name absent here is a name this guard is
 *  blind to, so new networks get added when they are pre-registered. */
const NETWORK_NAMES = [
    "test11", "test12", "test13", "test-13",
    "topaz", "topaz-1", "topaz-dev",
    "sapphire", "sapphire-1",
    "pearl", "pearl-1",
    "gnoland1", "portal-loop", "staging",
]

/**
 * Known, reviewed occurrences of a network literal in production source.
 *
 * `cutoverCritical: true` means "this names the chain the app is serving, and a
 * migration MUST update it" — those are cross-checked by tooth 2. Everything
 * else is a definition, a historical entry, or demo copy, and is pinned here
 * only so that a genuinely new pin cannot hide among them.
 */
interface Pin {
    file: string
    /** Network names this file is allowed to mention, in production code. */
    allow: string[]
    /** Included in the mutual-coherence check. */
    cutoverCritical?: boolean
    why: string
}

const ALLOWLIST: Pin[] = [
    {
        file: "lib/config.ts",
        allow: NETWORK_NAMES,
        why:
            "The single source of truth. NETWORKS entries and REALM_ALLOWLIST keys must " +
            "name every chain literally — that IS the definition. Retired chains stay " +
            "listed so old deep links resolve instead of crashing.",
    },
    {
        file: "lib/sitemap.ts",
        allow: ["sapphire"],
        cutoverCritical: true,
        why:
            "SITEMAP_NETWORK — the chain whose URLs are published to search engines. " +
            "Left stale across the topaz cutover and advertised a dead chain.",
    },
    {
        file: "lib/chainHealth.ts",
        allow: ["sapphire", "gnoland1"],
        cutoverCritical: true,
        why:
            "fallbackOrder — the chain ChainHaltedBanner offers as a one-click escape " +
            "when the active one is unreachable. gnoland1 is the deliberate last resort " +
            "and is not itself a cutover pin.",
    },
    {
        file: "lib/marketplace/seed/foundingSupply.seed.ts",
        allow: ["test13"],
        why:
            "Demo marketplace copy: prose descriptions and a literal 'Epoch: test13' " +
            "trait value on seed listings. Fixture text, not a runtime target — it " +
            "names test13 the way a screenshot would.",
    },
]

/** Strip comments without truncating strings. A naive `//` strip eats every
 *  `https://` URL in config.ts, and a naive block strip eats regexes — so walk
 *  the file tracking quote state instead. */
function stripComments(src: string): string {
    let out = ""
    let i = 0
    let quote: string | null = null
    while (i < src.length) {
        const c = src[i]
        const next = src[i + 1]
        if (quote) {
            if (c === "\\") { out += "  "; i += 2; continue }
            if (c === quote) quote = null
            out += c
            i++
            continue
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue }
        if (c === "/" && next === "/") {
            while (i < src.length && src[i] !== "\n") { out += " "; i++ }
            continue
        }
        if (c === "/" && next === "*") {
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
                out += src[i] === "\n" ? "\n" : " "
                i++
            }
            out += "  "
            i += 2
            continue
        }
        out += c
        i++
    }
    return out
}

function isExcluded(rel: string): boolean {
    return (
        /\.test\.tsx?$/.test(rel) ||
        rel.startsWith("test/") ||
        rel.includes("/__") ||
        /\.d\.ts$/.test(rel)
    )
}

function walk(abs: string, rel = ""): string[] {
    const out: string[] = []
    for (const entry of readdirSync(abs)) {
        const a = path.join(abs, entry)
        const r = rel ? `${rel}/${entry}` : entry
        if (statSync(a).isDirectory()) {
            if (entry === "node_modules") continue
            out.push(...walk(a, r))
        } else if (/\.tsx?$/.test(entry) && !isExcluded(r)) {
            out.push(r)
        }
    }
    return out
}

/** Escape EVERY regex metacharacter, not a hand-picked subset. The first cut
 *  escaped only `-`, which is not even special in an alternation — a partial
 *  escape is the shape of `js/incomplete-sanitization`, and CodeQL flagged it.
 *  Harmless here (NETWORK_NAMES is a hardcoded `[a-z0-9-]` list) but wrong as
 *  written, and this list is meant to grow. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")

const LITERAL = new RegExp(`["'\`](${NETWORK_NAMES.map(escapeRe).join("|")})["'\`]`, "g")

/** file -> the network names it mentions in real (non-comment) code. */
const found = new Map<string, Set<string>>()
for (const rel of walk(SRC)) {
    const code = stripComments(readFileSync(path.join(SRC, rel), "utf8"))
    const names = new Set<string>()
    for (const m of code.matchAll(LITERAL)) names.add(m[1])
    if (names.size) found.set(rel, names)
}

describe("network-pin drift guard", () => {
    it("finds pins at all — the scanner must not be silently blind", () => {
        // Floor. If the walker, the comment stripper or the regex breaks, every
        // assertion below passes vacuously while the codebase drifts freely.
        expect(found.size).toBeGreaterThan(0)
        expect(found.get("lib/config.ts")?.size ?? 0).toBeGreaterThan(2)
    })

    it("strips comments without eating strings", () => {
        // Negative controls for the two ways stripComments could rot: killing a
        // real pin (false green) or keeping a commented example (false red).
        expect(stripComments(`const a = "https://rpc.x/y"`)).toContain("https://rpc.x/y")
        expect(stripComments(`// see "test13"`)).not.toContain("test13")
        expect(stripComments(`/** e.g. "test13" */`)).not.toContain("test13")
        expect(stripComments(`const n = "sapphire" // was "test13"`)).toContain("sapphire")
        expect(stripComments(`const n = "sapphire" // was "test13"`)).not.toContain("test13")
    })

    it("no production file names a network without being reviewed here", () => {
        const allowed = new Map(ALLOWLIST.map((p) => [p.file, p]))
        const violations: string[] = []
        for (const [file, names] of found) {
            const pin = allowed.get(file)
            if (!pin) {
                violations.push(
                    `${file} names ${[...names].join(", ")} — a NEW network pin.\n` +
                        `      Derive it from config (DEFAULT_NETWORK / ACTIVE_NETWORK_KEY, or an\n` +
                        `      exported constant) rather than naming a chain here. If it genuinely\n` +
                        `      must be literal, add it to ALLOWLIST with a reason.`,
                )
                continue
            }
            const extra = [...names].filter((n) => !pin.allow.includes(n))
            if (extra.length) {
                violations.push(
                    `${file} now also names ${extra.join(", ")} (allowed: ${pin.allow.join(", ")}).`,
                )
            }
        }
        expect(violations, `\n\n  ${violations.join("\n\n  ")}\n`).toEqual([])
    })

    it("every allowlist entry still exists — no stale pins", () => {
        // The other direction: a pin that has been removed or renamed should not
        // linger here granting permission to a file that no longer needs it.
        const stale = ALLOWLIST.filter((p) => !found.has(p.file)).map((p) => p.file)
        expect(stale, `stale ALLOWLIST entries (file no longer pins a network): ${stale.join(", ")}`)
            .toEqual([])
    })

    it("cutover-critical pins all name the same network", () => {
        // Tooth 2. Partial cutovers are the failure mode: config.ts flips, and
        // sitemap.ts keeps publishing the old chain to search engines.
        const critical = ALLOWLIST.filter((p) => p.cutoverCritical)
        expect(critical.length).toBeGreaterThan(1)

        const perFile = critical.map((p) => {
            const names = found.get(p.file)
            // gnoland1 is chainHealth's declared last resort, never the active chain.
            const active = [...(names ?? [])].filter((n) => n !== "gnoland1")
            return { file: p.file, active }
        })

        for (const { file, active } of perFile) {
            expect(active.length, `${file} should pin exactly one active network, got [${active}]`)
                .toBe(1)
        }

        const distinct = [...new Set(perFile.map((p) => p.active[0]))]
        expect(
            distinct,
            `\n\n  Cutover-critical pins disagree — a migration updated some and not others:\n` +
                perFile.map((p) => `    ${p.file} -> ${p.active[0]}`).join("\n") +
                `\n\n  Every one of these must name the chain the app now serves.\n`,
        ).toHaveLength(1)
    })

    it("no cutover-critical pin names a retired chain", () => {
        // config.ts keeps retired networks so old deep links resolve; the pins
        // that decide what the app SERVES must not.
        const RETIRED = ["test11", "test12", "test13", "test-13", "topaz", "topaz-1", "topaz-dev"]
        const offenders: string[] = []
        for (const p of ALLOWLIST.filter((x) => x.cutoverCritical)) {
            for (const n of found.get(p.file) ?? []) {
                if (RETIRED.includes(n)) offenders.push(`${p.file} -> ${n}`)
            }
        }
        expect(offenders, `cutover-critical pins on a retired chain: ${offenders.join(", ")}`)
            .toEqual([])
    })
})

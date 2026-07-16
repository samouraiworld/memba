/**
 * Regression guard (Track 0 T0.3): the fabricated NFT collection-offer surface
 * must stay gone.
 *
 * `FloorOffersList` rendered hardcoded `g1fakebuyer0x` bidders and wired live
 * Make/Accept CTAs to `gno.land/r/samcrew/memba_nft_offers_v1` — a realm that is
 * undeployed AND pre-interrealm-v2 (won't compile). This asserts neither the
 * fabricated addresses nor the undeployed-realm path reappears anywhere in the
 * source, so a "trust the backend, and the backend invented it" surface can't
 * ship again. Reintroduce collection offers only against a deployed, fund-safe
 * offers engine.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const self = fileURLToPath(import.meta.url)
const srcRoot = path.join(path.dirname(self), "..") // src/lib/.. → src

const FORBIDDEN = ["g1fakebuyer", "memba_nft_offers_v1"]

function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
            out.push(...sourceFiles(full))
        } else if (/\.(ts|tsx)$/.test(entry) && full !== self) {
            out.push(full)
        }
    }
    return out
}

describe("no fabricated NFT collection-offer surface (T0.3)", () => {
    const files = sourceFiles(srcRoot)

    it("finds source files to scan (sanity)", () => {
        expect(files.length).toBeGreaterThan(50)
    })

    for (const term of FORBIDDEN) {
        it(`no source file references "${term}"`, () => {
            const offenders = files.filter((f) => readFileSync(f, "utf8").includes(term))
            expect(offenders).toEqual([])
        })
    }
})

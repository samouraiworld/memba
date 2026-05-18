import { describe, it, expect } from "vitest"
import { computeFocusAreas, _internals, FOCUS_TOPIC_LABELS } from "./gnoloveFocusAreas"

describe("classify", () => {
    const { classify } = _internals

    it("matches wallet via repo name", () => {
        expect(classify({ repo: "onbloc/adena-wallet", title: "x" })).toBe("wallet")
    })
    it("matches indexer via gnoscan repo name", () => {
        expect(classify({ repo: "onbloc/gnoscan", title: "x" })).toBe("indexer")
    })
    it("matches DEX via gnoswap repo name", () => {
        expect(classify({ repo: "onbloc/gnoswap-contracts", title: "x" })).toBe("dex")
    })
    it("matches governance via title", () => {
        expect(classify({ repo: "samouraiworld/memba", title: "feat: govdao proposal viewer" })).toBe("governance")
    })
    it("matches docs via title (whole word)", () => {
        expect(classify({ repo: "x/y", title: "fix: typo in README docs" })).toBe("docs")
    })
    it("falls through to other on unmatched signals", () => {
        expect(classify({ repo: "weirdorg/totallynewthing", title: "feat: random" })).toBe("other")
    })
    it("first-match-wins on ambiguous hits", () => {
        // 'core' would match gnocore, but the higher-priority gnovm rule
        // sees `gnoland/gno` repo name and wins.
        expect(classify({ repo: "gnoland/gno", title: "feat: core consensus tweak" })).toBe("gnovm")
    })
})

describe("computeFocusAreas", () => {
    it("returns [] for empty input", () => {
        expect(computeFocusAreas([])).toEqual([])
    })

    it("returns top 5 pills sorted by count desc", () => {
        const signals = [
            ...Array(10).fill({ repo: "onbloc/adena-wallet", title: "x" }),       // wallet × 10
            ...Array(7).fill({ repo: "onbloc/gnoscan", title: "x" }),             // indexer × 7
            ...Array(4).fill({ repo: "gnoland/gno", title: "x" }),                // gnovm × 4
            ...Array(3).fill({ repo: "x/y", title: "feat: docs typo fix" }),      // docs × 3
            ...Array(2).fill({ repo: "x/y", title: "feat: govdao proposal" }),    // governance × 2
            ...Array(1).fill({ repo: "x/y", title: "feat: nft listing" }),        // nft × 1
        ]
        const pills = computeFocusAreas(signals)
        expect(pills.map(p => p.topic)).toEqual(["wallet", "indexer", "gnovm", "docs", "governance"])
        expect(pills[0].count).toBe(10)
        expect(pills[0].share).toBeCloseTo(10 / 27)
    })

    it("hides 'other' below the 5% threshold", () => {
        const signals = [
            ...Array(20).fill({ repo: "onbloc/adena-wallet", title: "x" }),  // wallet
            { repo: "totally/unknown", title: "feat: weird" },                // other × 1 → 1/21 ≈ 4.7%
        ]
        const pills = computeFocusAreas(signals)
        expect(pills.find(p => p.topic === "other")).toBeUndefined()
    })

    it("keeps 'other' above the 5% threshold", () => {
        const signals = [
            ...Array(10).fill({ repo: "onbloc/adena-wallet", title: "x" }),       // wallet × 10
            ...Array(2).fill({ repo: "totally/unknown", title: "x" }),            // other × 2 → 2/12 ≈ 16.7%
        ]
        const pills = computeFocusAreas(signals)
        expect(pills.find(p => p.topic === "other")?.count).toBe(2)
    })

    it("populates a share that sums to 1 across all classified signals", () => {
        const signals = [
            ...Array(3).fill({ repo: "onbloc/adena-wallet", title: "x" }),
            ...Array(2).fill({ repo: "gnoland/gno", title: "x" }),
        ]
        const pills = computeFocusAreas(signals)
        const total = pills.reduce((s, p) => s + p.share, 0)
        expect(total).toBeCloseTo(1)
    })
})

describe("FOCUS_TOPIC_LABELS", () => {
    it("has a label for every defined topic", () => {
        const topics = ["gnovm", "gnocore", "gnosdk", "gnops", "security", "devx", "docs",
            "wallet", "indexer", "governance", "dex", "nft", "messaging", "ibc", "ai", "zk", "other"] as const
        for (const t of topics) {
            expect(FOCUS_TOPIC_LABELS[t]).toBeTruthy()
        }
    })
})

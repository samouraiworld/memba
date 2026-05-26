import { describe, it, expect, vi } from "vitest"
import {
    computeFocusAreas,
    compileBackendTopic,
    compileBackendTopics,
    _internals,
    FOCUS_TOPIC_LABELS,
    OTHER_SLUG,
} from "./gnoloveFocusAreas"

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
        // 'consensus' matches before 'gnocore' due to rule order.
        expect(classify({ repo: "gnoland/gno", title: "feat: core consensus tweak" })).toBe("consensus")
    })
    it("matches gnovm via conventional-commit prefix", () => {
        expect(classify({ repo: "gnoland/gno", title: "feat(gnovm): add new opcode" })).toBe("gnovm")
    })
    it("matches realms via conventional-commit prefix", () => {
        expect(classify({ repo: "gnoland/gno", title: "feat(gno.land): add blog realm" })).toBe("realms")
    })
    it("matches consensus via title keyword", () => {
        expect(classify({ repo: "gnoland/gno", title: "fix: tendermint round step bug" })).toBe("consensus")
    })
    it("matches frontend via title keyword", () => {
        expect(classify({ repo: "samouraiworld/memba", title: "feat: react component for chart" })).toBe("frontend")
    })
    it("matches testing via title keyword", () => {
        expect(classify({ repo: "samouraiworld/memba", title: "chore: add vitest coverage" })).toBe("testing")
    })
})

describe("computeFocusAreas", () => {
    it("returns [] for empty input", () => {
        expect(computeFocusAreas([])).toEqual([])
    })

    it("returns top 6 pills sorted by count desc", () => {
        const signals = [
            ...Array(10).fill({ repo: "onbloc/adena-wallet", title: "x" }),       // wallet × 10
            ...Array(7).fill({ repo: "onbloc/gnoscan", title: "x" }),             // indexer × 7
            ...Array(4).fill({ repo: "x/y", title: "feat(gnovm): update" }),      // gnovm × 4
            ...Array(3).fill({ repo: "x/y", title: "feat: docs typo fix" }),      // docs × 3
            ...Array(2).fill({ repo: "x/y", title: "feat: govdao proposal" }),    // governance × 2
            ...Array(1).fill({ repo: "x/y", title: "feat: nft listing" }),        // nft × 1
        ]
        const pills = computeFocusAreas(signals)
        expect(pills.map(p => p.topic)).toEqual(["wallet", "indexer", "gnovm", "docs", "governance", "nft"])
        expect(pills[0].count).toBe(10)
        expect(pills[0].share).toBeCloseTo(10 / 27)
    })

    it("never shows 'other' regardless of share", () => {
        const signals = [
            ...Array(5).fill({ repo: "onbloc/adena-wallet", title: "x" }),
            ...Array(5).fill({ repo: "totally/unknown", title: "zzz" }),
        ]
        const pills = computeFocusAreas(signals)
        expect(pills.find(p => p.topic === "other")).toBeUndefined()
    })

    it("populates correct share values relative to total signal count", () => {
        const signals = [
            ...Array(3).fill({ repo: "onbloc/adena-wallet", title: "x" }),
            ...Array(2).fill({ repo: "x/y", title: "feat(gnovm): fix" }),
        ]
        const pills = computeFocusAreas(signals)
        expect(pills).toHaveLength(2)
        expect(pills[0].share).toBeCloseTo(3 / 5)
        expect(pills[1].share).toBeCloseTo(2 / 5)
    })
})

describe("FOCUS_TOPIC_LABELS", () => {
    it("has a label for every defined topic", () => {
        const topics = ["gnovm", "consensus", "gnocore", "realms", "gnosdk", "gnops", "security",
            "devx", "frontend", "testing", "docs", "wallet", "indexer", "governance", "dex",
            "nft", "messaging", "ibc", "ai", "zk", "other"] as const
        for (const t of topics) {
            expect(FOCUS_TOPIC_LABELS[t]).toBeTruthy()
        }
    })
})

describe("computeFocusAreas with explicit rules", () => {
    it("uses caller-provided rules instead of the seed", () => {
        // Custom rule set: only one topic, "weird-stuff", matches everything.
        const rules = [{ topic: "weird-stuff", patterns: [/.+/] }]
        const pills = computeFocusAreas(
            [{ repo: "onbloc/adena-wallet", title: "x" }],
            rules,
        )
        expect(pills).toHaveLength(1)
        expect(pills[0].topic).toBe("weird-stuff")
    })

    it("returns empty when no caller rule matches (other is always hidden)", () => {
        const rules = [{ topic: "noop", patterns: [/^never-matches-this-input$/] }]
        const pills = computeFocusAreas(
            [
                { repo: "x", title: "a" },
                { repo: "y", title: "b" },
                { repo: "z", title: "c" },
            ],
            rules,
        )
        expect(pills).toEqual([])
    })
})

describe("compileBackendTopic", () => {
    it("compiles every pattern", () => {
        const rule = compileBackendTopic({
            slug: "wallet",
            label: "Wallet",
            patterns: ["adena", "\\bwallet\\b"],
        })
        expect(rule.topic).toBe("wallet")
        expect(rule.patterns).toHaveLength(2)
        expect(rule.patterns[0].test("adena-wallet")).toBe(true)
    })

    it("drops invalid regexes with a warning rather than throwing", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
        const rule = compileBackendTopic({
            slug: "broken",
            label: "Broken",
            patterns: ["[unclosed", "valid"],
        })
        expect(rule.patterns).toHaveLength(1)
        expect(rule.patterns[0].test("valid")).toBe(true)
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})

describe("compileBackendTopics", () => {
    it("falls back to the seed when the backend returns no topics", () => {
        const { rules, labels } = compileBackendTopics([])
        expect(rules).toBe(_internals.SEED_TOPIC_RULES)
        expect(labels).toBe(_internals.SEED_TOPIC_LABELS)
    })

    it("preserves backend order (first-match-wins matters)", () => {
        const { rules } = compileBackendTopics([
            { slug: "indexer", label: "Indexer", patterns: ["gnoscan"] },
            { slug: "wallet", label: "Wallet", patterns: ["adena"] },
        ])
        expect(rules.map(r => r.topic)).toEqual(["indexer", "wallet"])
    })

    it("builds a labels map and keeps the 'other' fallback label", () => {
        const { labels } = compileBackendTopics([
            { slug: "wallet", label: "Wallet (live)", patterns: ["adena"] },
        ])
        expect(labels.wallet).toBe("Wallet (live)")
        expect(labels[OTHER_SLUG]).toBeTruthy()
    })

    it("end-to-end: live taxonomy classifies signals the seed can't", () => {
        // A topic the seed doesn't know about — only the live taxonomy
        // can pick it up.
        const { rules } = compileBackendTopics([
            { slug: "graphql-api", label: "GraphQL API", patterns: ["graphql"] },
        ])
        const pills = computeFocusAreas(
            [{ repo: "x", title: "feat: graphql resolver tweak" }],
            rules,
        )
        expect(pills[0].topic).toBe("graphql-api")
    })
})

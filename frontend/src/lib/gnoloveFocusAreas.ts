/**
 * Focus Areas — client-side v1 of the team-hub expertise visualisation.
 *
 * Per operator decision Q-5: pills, not matrix, not force graph. The
 * full repo × topic matrix is a v1.5 follow-up behind a sub-flag.
 *
 * This module derives 5 pills per team by matching merged-PR signals
 * against a local topic taxonomy. Phase 2c (deferred) will migrate the
 * regex bag to gnolove/server/config/topics.yaml + GET /topics so the
 * client doesn't drift from the server-authoritative version.
 *
 * Match order (plan §9):
 *   1. PR labels (not yet in the schema — punted to v1.5)
 *   2. Repository name
 *   3. PR title
 *
 * The "other" bucket is hidden unless it represents > 5% of the team's
 * total signals — under that threshold it's noise, over it it's a real
 * signal that the team works on something the taxonomy doesn't cover.
 *
 * @module lib/gnoloveFocusAreas
 */

export type FocusTopic =
    | "gnovm"
    | "gnocore"
    | "gnosdk"
    | "gnops"
    | "security"
    | "devx"
    | "docs"
    | "wallet"
    | "indexer"
    | "governance"
    | "dex"
    | "nft"
    | "messaging"
    | "ibc"
    | "ai"
    | "zk"
    | "other"

interface TopicRule {
    topic: FocusTopic
    /** Patterns are matched case-insensitively against repo+title. */
    patterns: RegExp[]
}

// Order matters: earlier rules win on ambiguous hits (a "vm" + "core" repo
// counts as gnovm, not gnocore). Tuned so the highest-signal topics
// dominate when multiple match.
const TOPIC_RULES: TopicRule[] = [
    { topic: "gnovm", patterns: [/\bvm\b/, /interpreter/, /\bstack[- ]engine\b/, /gnoland\/gno/] },
    { topic: "gnocore", patterns: [/\bcore\b/, /\bprotocol\b/, /tm2/, /consensus/] },
    { topic: "gnosdk", patterns: [/\bsdk\b/, /\bjs-client\b/, /tx[- ]builder/] },
    { topic: "gnops", patterns: [/portal[- ]loop/, /validator/, /\binfra\b/, /deploy/, /\bops\b/] },
    { topic: "security", patterns: [/\bsecurity\b/, /\bauth\b/, /audit/, /multisig/, /signer/, /cve/] },
    { topic: "devx", patterns: [/gnopls/, /gno-?cli/, /devx/, /\btooling\b/, /\blinter\b/, /\blsp\b/] },
    { topic: "docs", patterns: [/\bdocs?\b/, /readme/, /tutorial/] },
    { topic: "wallet", patterns: [/adena/, /\bwallet\b/, /gnokey/] },
    { topic: "indexer", patterns: [/gnoscan/, /\bindexer\b/, /\bgraphql\b/] },
    { topic: "governance", patterns: [/govdao/, /\bgovern/, /\bproposal/, /multisig/] },
    { topic: "dex", patterns: [/gnoswap/, /\bdex\b/, /\bswap\b/, /\bamm\b/, /liquidity/] },
    { topic: "nft", patterns: [/\bnft\b/, /\berc721\b/, /grc721/] },
    { topic: "messaging", patterns: [/berty/, /messaging/, /\bp2p\b/] },
    { topic: "ibc", patterns: [/\bibc\b/, /cosmos[- ]sdk/, /relayer/] },
    { topic: "ai", patterns: [/\bai\b/, /mistral/, /openrouter/, /\bllm\b/] },
    { topic: "zk", patterns: [/\bzk\b/, /zero[- ]knowledge/, /\bsnark\b/, /\bstark\b/] },
]

export const FOCUS_TOPIC_LABELS: Record<FocusTopic, string> = {
    gnovm: "Gno VM",
    gnocore: "Core protocol",
    gnosdk: "SDK",
    gnops: "Ops & infra",
    security: "Security",
    devx: "DevX & tooling",
    docs: "Docs",
    wallet: "Wallet",
    indexer: "Indexer & API",
    governance: "Governance",
    dex: "DEX",
    nft: "NFT",
    messaging: "Messaging",
    ibc: "IBC",
    ai: "AI",
    zk: "ZK",
    other: "Other",
}

export interface FocusPill {
    topic: FocusTopic
    count: number
    /** Share of total signals, 0–1. */
    share: number
}

const TOP_N = 5
const OTHER_HIDE_THRESHOLD = 0.05

interface Signal {
    repo: string
    title: string
}

/**
 * Score one signal against the taxonomy. Returns the first matching topic
 * by rule order; "other" if none match.
 */
function classify(signal: Signal): FocusTopic {
    const haystack = `${signal.repo} ${signal.title}`.toLowerCase()
    for (const rule of TOPIC_RULES) {
        if (rule.patterns.some(re => re.test(haystack))) return rule.topic
    }
    return "other"
}

/**
 * Aggregate signals → top-N pills.
 * Each signal is `(repo, title)` derived from a merged PR.
 */
export function computeFocusAreas(signals: Signal[]): FocusPill[] {
    if (signals.length === 0) return []
    const counts = new Map<FocusTopic, number>()
    for (const s of signals) {
        const topic = classify(s)
        counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
    const total = signals.length
    const entries: FocusPill[] = Array.from(counts.entries()).map(([topic, count]) => ({
        topic,
        count,
        share: count / total,
    }))
    // "other" is hidden when it's noise; promoted when it's a real signal.
    const filtered = entries.filter(p => p.topic !== "other" || p.share > OTHER_HIDE_THRESHOLD)
    filtered.sort((a, b) => b.count - a.count)
    return filtered.slice(0, TOP_N)
}

/** Exposed for tests. */
export const _internals = { classify, TOPIC_RULES, OTHER_HIDE_THRESHOLD, TOP_N }

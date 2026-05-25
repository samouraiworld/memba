/**
 * Focus Areas — client-side v1 of the team-hub expertise visualisation.
 *
 * Per operator decision Q-5: pills, not matrix, not force graph. The full
 * repo × topic matrix is a v1.5 follow-up behind a sub-flag.
 *
 * As of Phase 2c (2026-05), the regex bag is authoritative on the
 * gnolove backend at `server/config/topics.yaml`. This module keeps the
 * legacy bag as a SEED so pre-fetch / offline / SSR callers still get a
 * useful classification; consumers should call {@link useGnoloveTopics}
 * to get the live rules and pass them into {@link computeFocusAreas}.
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

import type { TBackendTopic } from "./gnoloveSchemas"

/**
 * A topic slug. Was a literal-union; widened in Phase 2c because the
 * backend now owns the taxonomy and the union would drift on every
 * config deploy.
 */
export type FocusTopic = string

/** The reserved slug the classifier returns when no rule matches. */
export const OTHER_SLUG: FocusTopic = "other"

/** A compiled rule, ready for the classifier. */
export interface TopicRule {
    topic: FocusTopic
    /** Patterns are matched case-insensitively against repo+title. */
    patterns: RegExp[]
}

/**
 * Seed rules used when the backend `/topics` endpoint hasn't responded
 * yet or has failed. Kept in sync with `server/config/topics.yaml` —
 * any divergence is a temporary drift between the client's last build
 * and the latest server config, resolved as soon as `useGnoloveTopics`
 * fetches.
 *
 * Order matters: earlier rules win on ambiguous hits. Conventional-commit
 * prefixes like `feat(gnovm):` are matched first for precision.
 */
const SEED_TOPIC_RULES: TopicRule[] = [
    { topic: "gnovm", patterns: [/\(gnovm\)/, /\bvm\b/, /interpreter/, /\bstack[- ]engine\b/, /gnomod/, /precompile/, /type-check/, /transpile/, /\bast\b/, /\bparser\b/] },
    { topic: "consensus", patterns: [/\(consensus\)/, /\bconsensus\b/, /\btendermint\b/, /\bbft\b/, /\bvalidator set\b/, /\bblock\b/] },
    { topic: "gnocore", patterns: [/\(tm2\)/, /\bcore\b/, /\bprotocol\b/, /tm2/] },
    { topic: "realms", patterns: [/\(gno\.land\)/, /\brealm\b/, /\bpackage\b/, /grc20/, /\bavl\b/, /r\//, /p\//] },
    { topic: "gnosdk", patterns: [/\bsdk\b/, /\bjs-client\b/, /tx[- ]builder/] },
    { topic: "gnops", patterns: [/\(ci\)/, /\(build\)/, /portal[- ]loop/, /\binfra\b/, /deploy/, /\bops\b/, /\bci\b/] },
    { topic: "security", patterns: [/\bsecurity\b/, /\bauth\b/, /audit/, /multisig/, /signer/, /cve/] },
    { topic: "devx", patterns: [/gnopls/, /gno-?cli/, /devx/, /\btooling\b/, /\blinter\b/, /\blsp\b/] },
    { topic: "frontend", patterns: [/\breact\b/, /\bvite\b/, /\bcss\b/, /\bui\b/, /component/, /\bux\b/, /\bfrontend\b/] },
    { topic: "testing", patterns: [/\btest\b/, /\bvitest\b/, /\be2e\b/, /coverage/, /\bci\/cd\b/] },
    { topic: "docs", patterns: [/\bdocs?\b/, /readme/, /tutorial/] },
    { topic: "wallet", patterns: [/adena/, /\bwallet\b/, /gnokey/] },
    { topic: "indexer", patterns: [/gnoscan/, /\bindexer\b/, /\bgraphql\b/] },
    { topic: "governance", patterns: [/govdao/, /\bgovern/, /\bproposal/] },
    { topic: "dex", patterns: [/gnoswap/, /\bdex\b/, /\bswap\b/, /\bamm\b/, /liquidity/] },
    { topic: "nft", patterns: [/\bnft\b/, /\berc721\b/, /grc721/] },
    { topic: "messaging", patterns: [/berty/, /messaging/, /\bp2p\b/] },
    { topic: "ibc", patterns: [/\bibc\b/, /cosmos[- ]sdk/, /relayer/] },
    { topic: "ai", patterns: [/\bai\b/, /mistral/, /openrouter/, /\bllm\b/] },
    { topic: "zk", patterns: [/\bzk\b/, /zero[- ]knowledge/, /\bsnark\b/, /\bstark\b/] },
]

/** Seed labels for the topic slugs; merged with backend labels at render time. */
const SEED_TOPIC_LABELS: Record<FocusTopic, string> = {
    gnovm: "Gno VM",
    consensus: "Consensus",
    gnocore: "Core / TM2",
    realms: "Realms & packages",
    gnosdk: "SDK",
    gnops: "Ops & infra",
    security: "Security",
    devx: "DevX & tooling",
    frontend: "Frontend",
    testing: "Testing & CI",
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
    [OTHER_SLUG]: "Other",
}

/**
 * Exported for back-compat and as the fallback label map. Consumers that
 * have live backend topics should prefer the labels from
 * {@link useGnoloveTopics} so newly-shipped server topics render with
 * their server-side label instead of the slug itself.
 */
export const FOCUS_TOPIC_LABELS = SEED_TOPIC_LABELS

export interface FocusPill {
    topic: FocusTopic
    count: number
    /** Share of total signals, 0–1. */
    share: number
}

const TOP_N = 6

interface Signal {
    repo: string
    title: string
}

/**
 * Score one signal against a rule set. Returns the first matching topic
 * by rule order; {@link OTHER_SLUG} if none match.
 */
function classify(signal: Signal, rules: TopicRule[] = SEED_TOPIC_RULES): FocusTopic {
    const haystack = `${signal.repo} ${signal.title}`.toLowerCase()
    for (const rule of rules) {
        if (rule.patterns.some(re => re.test(haystack))) return rule.topic
    }
    return OTHER_SLUG
}

/**
 * Aggregate signals → top-N pills.
 * Each signal is `(repo, title)` derived from a merged PR.
 *
 * @param signals merged-PR signals to classify
 * @param rules   compiled rule set; defaults to the build-time seed
 */
export function computeFocusAreas(
    signals: Signal[],
    rules: TopicRule[] = SEED_TOPIC_RULES,
): FocusPill[] {
    if (signals.length === 0) return []
    const counts = new Map<FocusTopic, number>()
    for (const s of signals) {
        const topic = classify(s, rules)
        counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
    const total = signals.length
    const entries: FocusPill[] = Array.from(counts.entries()).map(([topic, count]) => ({
        topic,
        count,
        share: count / total,
    }))
    const filtered = entries.filter(p => p.topic !== OTHER_SLUG)
    filtered.sort((a, b) => b.count - a.count)
    return filtered.slice(0, TOP_N)
}

/**
 * Convert a backend topic into a {@link TopicRule} ready for the
 * classifier. Patterns are compiled on the fly; bad regexes are dropped
 * with a console warning rather than blowing up the page — better to
 * render a partially-populated rule than to crash the whole hub.
 */
export function compileBackendTopic(t: TBackendTopic): TopicRule {
    const compiled: RegExp[] = []
    for (const p of t.patterns) {
        try {
            compiled.push(new RegExp(p))
        } catch (err) {
            console.warn(`[gnolove] dropping invalid topic pattern for ${t.slug}: ${p}`, err)
        }
    }
    return { topic: t.slug, patterns: compiled }
}

/**
 * Compile a backend `/topics` payload into the rule + label maps the
 * classifier and renderer need. Order is preserved (first-match-wins).
 *
 * If the backend returns no topics, the seed is returned instead — the
 * page must always have *something* to classify against.
 */
export function compileBackendTopics(
    topics: TBackendTopic[],
): { rules: TopicRule[]; labels: Record<FocusTopic, string> } {
    if (topics.length === 0) {
        return { rules: SEED_TOPIC_RULES, labels: SEED_TOPIC_LABELS }
    }
    const rules = topics.map(compileBackendTopic)
    const labels: Record<FocusTopic, string> = { [OTHER_SLUG]: SEED_TOPIC_LABELS[OTHER_SLUG] }
    for (const t of topics) labels[t.slug] = t.label
    return { rules, labels }
}

/** Exposed for tests. */
export const _internals = {
    classify,
    SEED_TOPIC_RULES,
    SEED_TOPIC_LABELS,
    TOP_N,
}

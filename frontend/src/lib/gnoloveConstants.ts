/**
 * Gnolove constants — Teams, TimeFilter, and Milestone config.
 *
 * Ported from gnolove/src/constants/teams.ts and gnolove/src/utils/github.ts.
 * Radix UI `BadgeProps['color']` replaced with vanilla `TeamColor` string union.
 *
 * @module lib/gnoloveConstants
 */

// ── Team Color (replaces Radix UI BadgeProps['color']) ────────

export type TeamColor = "blue" | "yellow" | "purple" | "red" | "green" | "brown" | "pink"

export interface Team {
    /** Stable slug — matches backend gnolove/server/config/teams.yaml. */
    slug: string
    name: string
    color: TeamColor
    members: string[]
    description?: string
    logoUrl?: string
}

/**
 * Build-time seed roster.
 *
 * Phase 3 (2026-05) moved the source of truth to the gnolove backend's
 * `config/teams.yaml`, served via `GET /teams`. This constant is now the
 * SEED used for:
 *   - first paint before the hook resolves,
 *   - offline / backend-down fallback,
 *   - URL-state validation (which has to run synchronously).
 *
 * For UI that renders live roster data, use `useGnoloveTeams()` instead.
 * The hook returns the fetched roster when available, this seed otherwise.
 */
export const TEAMS: Team[] = [
    {
        slug: "core-team",
        name: "Core Team",
        color: "blue",
        description: "Gno core protocol engineers building the chain, VM, and standard libraries.",
        members: [
            "sw360cab", "jaekwon", "ajnavarro", "gfanton", "ltzmaxwell",
            "zivkovicmilos", "thehowl", "piux2", "petar-dambovaliev", "mvertes",
            "moul", "dependabot", "kouteki", "kristovatlas", "aeddi", "wyhaines",
        ],
    },
    {
        slug: "all-in-bits",
        name: "All in Bits",
        color: "yellow",
        description: "AiB team contributing to Gno ecosystem tooling and infrastructure.",
        members: ["albttx", "alexiscolin", "tbruyelle", "leohhhn", "n2p5", "michelleellen"],
    },
    {
        slug: "onbloc",
        name: "Onbloc",
        color: "purple",
        description: "Building GnoSwap DEX, Adena wallet, and GnoScan explorer.",
        // Roster fix landed via teams.yaml (Phase 1): dongwon8247 (was dongonw8247),
        // plus aronpark1007, HeesungB, junghoon-vans, gihun508443.
        members: [
            "notJoon", "r3v4s", "adr-sk", "jinoosss",
            "dongwon8247", "aronpark1007", "HeesungB", "junghoon-vans", "gihun508443",
        ],
    },
    {
        slug: "varmeta",
        name: "VarMeta",
        color: "yellow",
        description: "Vietnam-based team contributing to Gno core and tooling.",
        members: ["linhpn99", "thinhnx-var", "AnhVAR"],
    },
    {
        slug: "samouraiworld",
        name: "Samourai.world",
        color: "red",
        description: "Building Memba, gnolove, gnomonitoring, and ecosystem dApps.",
        members: [
            "n0izn0iz", "omarsy", "Villaquiranm", "hthieu1110",
            "mvallenet", "WaDadidou", "dtczelo", "naim-ea",
            "louis14448", "pr0m3th3usEx", "davd-gzl", "moonia",
            "zxxma", "clegirar", "omniwired", "AmozPay",
        ],
    },
    {
        slug: "berty",
        name: "Berty",
        color: "green",
        description: "Decentralized messaging protocol team contributing to Gno networking.",
        members: ["jefft0", "D4ryl00", "iuricmp"],
    },
    {
        slug: "devx",
        name: "DevX",
        color: "brown",
        description: "Developer experience team improving Gno SDK and toolchain.",
        members: ["ilgooz", "jeronimoalbi", "salmad3"],
    },
    {
        slug: "grants",
        name: "Grants",
        color: "pink",
        description: "Independent contributors funded through the Gno grants program.",
        members: [
            "NicolasMelet", "Chaegnal", "paulogarithm", "louonezime",
            "Milosevic02", "Tchips46", "matijamarjanovic", "odeke-em",
        ],
    },
]

// ── Team color map for CSS ───────────────────────────────────

export const TEAM_CSS_COLORS: Record<TeamColor, string> = {
    blue: "#4a9eff",
    yellow: "#ffc107",
    purple: "#a855f7",
    red: "#ef4444",
    green: "#22c55e",
    brown: "#b47a4a",
    pink: "#ec4899",
}

// ── Time Filter ──────────────────────────────────────────────

export enum TimeFilter {
    ALL_TIME = "all",
    YEARLY = "yearly",
    MONTHLY = "monthly",
    WEEKLY = "weekly",
}

export const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
    [TimeFilter.ALL_TIME]: "All Time",
    [TimeFilter.YEARLY]: "This Year",
    [TimeFilter.MONTHLY]: "This Month",
    [TimeFilter.WEEKLY]: "This Week",
}

export function isTimeFilter(value: string): value is TimeFilter {
    return Object.values(TimeFilter).includes(value as TimeFilter)
}

// ── Milestone ────────────────────────────────────────────────

export const MILESTONE_NUMBER = 7

// ── PR Status Tabs ───────────────────────────────────────────

export type ReportTab = "merged" | "in_progress" | "waiting_for_review" | "reviewed" | "blocked"

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
    merged: "Merged",
    in_progress: "In Progress",
    waiting_for_review: "Waiting for Review",
    reviewed: "Reviewed",
    blocked: "Blocked",
}

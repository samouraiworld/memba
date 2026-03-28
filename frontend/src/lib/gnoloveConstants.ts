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
    name: string
    color: TeamColor
    members: string[]
}

export const TEAMS: Team[] = [
    {
        name: "Core Team",
        color: "blue",
        members: [
            "sw360cab", "jaekwon", "ajnavarro", "gfanton", "ltzmaxwell",
            "zivkovicmilos", "thehowl", "piux2", "petar-dambovaliev", "mvertes",
            "moul", "dependabot", "kouteki", "kristovatlas", "aeddi", "wyhaines",
        ],
    },
    {
        name: "All in Bits",
        color: "yellow",
        members: ["albttx", "alexiscolin", "tbruyelle", "leohhhn", "n2p5", "michelleellen"],
    },
    {
        name: "Onbloc",
        color: "purple",
        members: ["notJoon", "r3v4s", "adr-sk", "jinoosss"],
    },
    {
        name: "VarMeta",
        color: "yellow",
        members: ["linhpn99", "thinhnx-var", "AnhVAR"],
    },
    {
        name: "Samourai.world",
        color: "red",
        members: [
            "n0izn0iz", "omarsy", "villaquiranm", "hthieu1110",
            "MikaelVallenet", "WaDadidou", "dtczelo", "naim-ea",
            "louis14448", "pr0m3th3usEx", "davd-gzl", "moonia",
        ],
    },
    {
        name: "Berty",
        color: "green",
        members: ["jefft0", "D4ryl00", "iuricmp"],
    },
    {
        name: "DevX",
        color: "brown",
        members: ["ilgooz", "jeronimoalbi", "salmad3"],
    },
    {
        name: "Grants",
        color: "pink",
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

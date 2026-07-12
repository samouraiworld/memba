/**
 * points.ts — read-only client for the on-chain memba_points_v1 reputation ledger (MP).
 *
 * All reads go through vm/qeval against the realm's JSON encoders (ProfileJSON / TopN / TopNPage /
 * TierBandsJSON). Tier + rank are CANONICAL on-chain — never re-derived client-side. Gated behind
 * VITE_ENABLE_POINTS (off): the realm is undeployed, so reads return empty/null until deploy + awarder
 * wiring. Every parsed payload is shape-validated before use (never trust chain data blindly).
 *
 * `strict` (per read) forwards to queryEval: when true, a transport failure or ABCI-level error THROWS
 * instead of collapsing to empty — so a caller (e.g. the leaderboard) can tell "RPC down / not
 * deployed" apart from "genuinely empty" and surface an error state. Left false, reads are lenient.
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { GNO_RPC_URL } from "./config"

const REALM_PATH =
    (import.meta.env.VITE_POINTS_REALM_PATH as string) || "gno.land/r/samcrew/memba_points_v1"

// SECURITY: the ONLY guard against qeval-expression injection (queryEval does not sanitize). Only
// well-formed gno addresses are ever interpolated — NEVER loosen this to admit quotes/parens/backslash.
const ADDR_RE = /^g1[a-z0-9]{38,}$/

export interface PointsProfile {
    addr: string
    points: number
    /** Canonical on-chain tier name ("" if no bands configured). */
    tier: string
    /** 1-based rank; 0 = unranked (holds no points). */
    rank: number
    holders: number
}

export interface LeaderRow {
    rank: number
    addr: string
    points: number
    tier: string
}

export interface TierBand {
    name: string
    minPoints: number
}

function isProfile(v: unknown): v is PointsProfile {
    const o = v as Record<string, unknown> | null
    return (
        !!o &&
        typeof o.addr === "string" &&
        typeof o.points === "number" &&
        typeof o.tier === "string" &&
        typeof o.rank === "number" &&
        typeof o.holders === "number"
    )
}

function isLeaderRow(v: unknown): v is LeaderRow {
    const o = v as Record<string, unknown> | null
    return (
        !!o &&
        typeof o.rank === "number" &&
        typeof o.addr === "string" &&
        typeof o.points === "number" &&
        typeof o.tier === "string"
    )
}

function isTierBand(v: unknown): v is TierBand {
    const o = v as Record<string, unknown> | null
    return !!o && typeof o.name === "string" && typeof o.minPoints === "number"
}

/** One address's points + canonical tier + exact rank + holder count. null when unknown/unavailable. */
export async function getProfile(address: string, strict = false): Promise<PointsProfile | null> {
    if (!ADDR_RE.test(address)) return null
    const raw = await queryEval(GNO_RPC_URL, REALM_PATH, `ProfileJSON(${JSON.stringify(address)})`, strict)
    if (!raw) return null
    const v = parseQevalJSON(raw)
    return isProfile(v) ? v : null
}

/** Top-N leaderboard rows (points-descending). Empty on any failure. n is clamped to [1, 200]. */
export async function getTopN(n: number, strict = false): Promise<LeaderRow[]> {
    const count = Math.max(1, Math.min(200, n | 0))
    const raw = await queryEval(GNO_RPC_URL, REALM_PATH, `TopN(${count})`, strict)
    if (!raw) return []
    const v = parseQevalJSON(raw)
    return Array.isArray(v) ? v.filter(isLeaderRow) : []
}

/** A leaderboard page from `offset` (0-based), up to `count` rows (clamped to [1, 200]). */
export async function getTopNPage(offset: number, count: number, strict = false): Promise<LeaderRow[]> {
    const off = Math.max(0, offset | 0)
    const cnt = Math.max(1, Math.min(200, count | 0))
    const raw = await queryEval(GNO_RPC_URL, REALM_PATH, `TopNPage(${off}, ${cnt})`, strict)
    if (!raw) return []
    const v = parseQevalJSON(raw)
    return Array.isArray(v) ? v.filter(isLeaderRow) : []
}

/** The on-chain tier ladder (ascending by minPoints). Empty on any failure. */
export async function getTierBands(strict = false): Promise<TierBand[]> {
    const raw = await queryEval(GNO_RPC_URL, REALM_PATH, "TierBandsJSON()", strict)
    if (!raw) return []
    const v = parseQevalJSON(raw)
    return Array.isArray(v) ? v.filter(isTierBand) : []
}

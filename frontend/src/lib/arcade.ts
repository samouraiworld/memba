/**
 * arcade.ts — client for BARRICADE on-chain certify (G3).
 *
 * Two surfaces, both dark until the owner enables them:
 *  - getBoard(day): read the leaderboard realm's competitive daily board over
 *    vm/qeval (points.ts pattern — shape-validated, injection-guarded). Returns
 *    empty until the realm is deployed.
 *  - submitRun(body, token): POST a re-simulated run to the backend certify
 *    endpoint (404 until MEMBA_ARCADE_SUBMIT_ENABLED). Auth is the standard REST
 *    bearer token; play itself stays no-wallet.
 *
 * Nothing here moves funds; the certify flag is NOT safety-gated.
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { API_BASE_URL, GNO_RPC_URL } from "./config"

const REALM_PATH =
    (import.meta.env.VITE_ARCADE_REALM_PATH as string) || "gno.land/r/samcrew/memba_arcade_leaderboard_v1"

// SECURITY: the day string is interpolated into a qeval expression (queryEval
// does not sanitize). Only a literal YYYY-MM-DD is ever allowed through — never
// loosen this to admit quotes/parens/backslash.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface BoardEntry {
    addr: string
    day: string
    mode: string
    score: number
    waves: number
    won: boolean
    overtimeRound: number
    simVersion: number
    stateHash: string
    inputLogSha256: string
    attestedAt: number
}

function isBoardEntry(v: unknown): v is BoardEntry {
    const o = v as Record<string, unknown> | null
    return (
        !!o &&
        typeof o.addr === "string" &&
        typeof o.day === "string" &&
        typeof o.mode === "string" &&
        typeof o.score === "number" &&
        typeof o.waves === "number" &&
        typeof o.won === "boolean" &&
        typeof o.overtimeRound === "number" &&
        typeof o.simVersion === "number" &&
        typeof o.stateHash === "string" &&
        typeof o.inputLogSha256 === "string" &&
        typeof o.attestedAt === "number"
    )
}

/**
 * One day's competitive board, rank-ordered, shape-validated. Empty on any
 * failure or malformed day (never throws — a display surface). offset/limit are
 * clamped to the realm's page bounds.
 */
export async function getBoard(day: string, offset: number, limit: number, strict = false): Promise<BoardEntry[]> {
    if (!DAY_RE.test(day)) return []
    const off = Math.max(0, offset | 0)
    const lim = Math.max(1, Math.min(100, limit | 0))
    const raw = await queryEval(GNO_RPC_URL, REALM_PATH, `GetBoardJSON(${JSON.stringify(day)}, ${off}, ${lim})`, strict)
    if (!raw) return []
    const v = parseQevalJSON(raw) as { entries?: unknown } | null
    const entries = v && Array.isArray(v.entries) ? v.entries : []
    return entries.filter(isBoardEntry)
}

export interface ArcadeSubmitBody {
    seed: string
    simVersion: number
    events: unknown[]
    claimedScore: number
    claimedHash: string
}

export interface ArcadeSubmitResult {
    verified: boolean
    logHash: string
    day: string
    mode: string
    result: { score?: number; waves?: number; won?: boolean; overtimeRound?: number; stateHash?: string; simVersion?: number }
}

/**
 * Submit a re-simulated run to the certify endpoint. `token` is the raw stored
 * auth token (localStorage "memba_auth_token") sent as a bearer — the backend
 * binds the run to the wallet it proves. Throws on any non-2xx (surfacing the
 * backend's rejection reason) and refuses to send without a token.
 */
export async function submitRun(body: ArcadeSubmitBody, token: string): Promise<ArcadeSubmitResult> {
    if (!token) {
        throw new Error("Sign in with your wallet to certify a run.")
    }
    const res = await fetch(`${API_BASE_URL || ""}/api/arcade/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const reason = await res
            .json()
            .then((j: { reason?: string; error?: string }) => j.reason || j.error)
            .catch(() => "")
        throw new Error(reason || `certify failed (${res.status})`)
    }
    return (await res.json()) as ArcadeSubmitResult
}

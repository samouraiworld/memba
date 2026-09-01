/**
 * arcade.ts — client for the multi-game arcade on-chain certify pipeline
 * (BARRICADE G3, Space Invaders M3).
 *
 * Two surfaces, both dark until the owner enables them:
 *  - getBoard(game, day): read the leaderboard realm's competitive per-game
 *    daily board over vm/qeval (points.ts pattern — shape-validated,
 *    injection-guarded). Returns empty until the realm is deployed.
 *  - submitRun(body, token): POST a re-simulated run to the backend certify
 *    endpoint (404 until MEMBA_ARCADE_SUBMIT_ENABLED; the backend derives the
 *    game from the seed grammar). Auth is the standard REST bearer token; play
 *    itself stays no-wallet.
 *
 * Nothing here moves funds; the certify flags are NOT safety-gated.
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { API_BASE_URL, GNO_RPC_URL } from "./config"

const REALM_PATH =
    (import.meta.env.VITE_ARCADE_REALM_PATH as string) || "gno.land/r/samcrew/memba_arcade_leaderboard_v1"

// SECURITY: the day and game strings are interpolated into a qeval expression
// (queryEval does not sanitize). Only a literal YYYY-MM-DD day and a bare
// [a-z0-9-]{1,32} game slug (the realm's own assertGameSlug charset) are ever
// allowed through — never loosen these to admit quotes/parens/backslash.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const GAME_RE = /^[a-z0-9-]{1,32}$/

// The multi-game realm's board entry: per-game context (waves/won/…) travels in
// the opaque `stats` JSON string the attester wrote; ranking only ever reads
// `score`.
export interface BoardEntry {
    game: string
    addr: string
    day: string
    mode: string
    score: number
    simVersion: number
    stateHash: string
    inputLogSha256: string
    stats: string
    attestedAt: number
}

function isBoardEntry(v: unknown): v is BoardEntry {
    const o = v as Record<string, unknown> | null
    return (
        !!o &&
        typeof o.game === "string" &&
        typeof o.addr === "string" &&
        typeof o.day === "string" &&
        typeof o.mode === "string" &&
        typeof o.score === "number" &&
        typeof o.simVersion === "number" &&
        typeof o.stateHash === "string" &&
        typeof o.inputLogSha256 === "string" &&
        typeof o.stats === "string" &&
        typeof o.attestedAt === "number"
    )
}

/**
 * One game-day's competitive board, rank-ordered, shape-validated. Empty on any
 * failure or malformed game/day (never throws — a display surface).
 * offset/limit are clamped to the realm's page bounds.
 */
export async function getBoard(
    game: string,
    day: string,
    offset: number,
    limit: number,
    strict = false,
): Promise<BoardEntry[]> {
    if (!GAME_RE.test(game)) return []
    if (!DAY_RE.test(day)) return []
    const off = Math.max(0, offset | 0)
    const lim = Math.max(1, Math.min(100, limit | 0))
    const raw = await queryEval(
        GNO_RPC_URL,
        REALM_PATH,
        `GetBoardJSON(${JSON.stringify(game)}, ${JSON.stringify(day)}, ${off}, ${lim})`,
        strict,
    )
    if (!raw) return []
    const v = parseQevalJSON(raw) as { entries?: unknown } | null
    const entries = v && Array.isArray(v.entries) ? v.entries : []
    return entries.filter(isBoardEntry)
}

export interface ArcadeSubmitBody {
    seed: string
    simVersion: number
    events: unknown[]
    // Space Invaders only (its sim runs to a tick count, not a terminal phase):
    // required there, and must stay ABSENT for BARRICADE — the backend rejects
    // a stray finalTick on a barricade seed.
    finalTick?: number
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

/**
 * connect4.ts — client for the staked Connect 4 realm (testnet demo).
 *
 * Reads go over vm/qeval to the realm's GameJSON / ActiveJSON accessors;
 * writes go through doContractBroadcast (Adena). Stakes are real ugnot, so the
 * realm path exists only on testnets (connect4PathFor).
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { ACTIVE_NETWORK_KEY, GNO_RPC_URL, connect4PathFor } from "./config"
import { doContractBroadcast, type AminoMsg } from "./grc20"
import { hasLocalSession, quickPlayCall, QuickPlayUnavailable } from "./quickPlay"

export type Status = "open" | "playing" | "won" | "draw" | "void" | "cancelled"

export interface Game {
    id: number
    creator: string
    opponent: string
    acceptor: string
    stake: number
    fee: number
    expiresAt: number
    commitment: string
    board: string
    turn: 0 | 1 | 2
    turnPlayer: string
    moves: number
    lastCol: number
    lastRow: number
    deadline: number
    status: Status
    winner: string
}

const STATUSES: readonly string[] = ["open", "playing", "won", "draw", "void", "cancelled"]
const BOARD_RE = /^[012]{42}$/

export function isGame(v: unknown): v is Game {
    const o = v as Record<string, unknown> | null
    if (!o || typeof o !== "object") return false
    const nums = ["id", "stake", "fee", "expiresAt", "moves", "lastCol", "lastRow", "deadline"]
    const strs = ["creator", "opponent", "acceptor", "commitment", "turnPlayer", "winner"]
    return nums.every((k) => typeof o[k] === "number")
        && strs.every((k) => typeof o[k] === "string")
        && typeof o.board === "string" && BOARD_RE.test(o.board)
        && (o.turn === 0 || o.turn === 1 || o.turn === 2)
        && typeof o.status === "string" && STATUSES.includes(o.status)
}

export function realmPath(): string | null {
    return connect4PathFor(ACTIVE_NETWORK_KEY)
}

// SECURITY: queryEval does not sanitize. Only integers that pass this check
// are ever interpolated into a qeval expression — never strings.
const isIndex = (n: number) => Number.isSafeInteger(n) && n >= 0

async function evalJSON(expr: string): Promise<Record<string, unknown> | null> {
    const path = realmPath()
    if (!path) return null
    const raw = await queryEval(GNO_RPC_URL, path, expr, false).catch(() => null)
    if (!raw) return null
    const v = parseQevalJSON(raw) as Record<string, unknown> | null
    return v && typeof v.now === "number" ? v : null
}

/** One game with the chain time; game is null when unknown or malformed. Null on failure. */
export async function getGame(id: number): Promise<{ now: number; game: Game | null } | null> {
    if (!isIndex(id)) return null
    const v = await evalJSON(`GameJSON(${id})`)
    if (!v) return null
    return { now: v.now as number, game: isGame(v.game) ? v.game : null }
}

/** Open and Playing games in id order with the chain time. Null on failure. */
export async function getActive(offset: number, limit: number): Promise<{ now: number; games: Game[] } | null> {
    if (!isIndex(offset) || !isIndex(limit)) return null
    const lim = Math.max(1, Math.min(100, limit))
    const v = await evalJSON(`ActiveJSON(${offset}, ${lim})`)
    if (!v) return null
    return { now: v.now as number, games: Array.isArray(v.games) ? v.games.filter(isGame) : [] }
}

// WRITES

export type Connect4Func = "Offer" | "Accept" | "Reveal" | "Play" | "ClaimTimeout" | "Resign" | "Cancel"

// Storage deposit cap per call. Offer on onyx-1 stored 7,589 bytes (758,900ugnot
// at 100ugnot/byte, simulated 2026-09-30); 2x, rounded up to a whole GNOT.
const MAX_DEPOSIT_UGNOT = 2_000_000
// Offer simulated at 8.24M gas; the 10M app default leaves too little room for a
// settling Play (payout + Stats writes), and an out-of-gas winning move forfeits.
const GAS_WANTED = 20_000_000

export function buildCall(func: Connect4Func, args: string[], caller: string, sendUgnot?: number): AminoMsg {
    const path = realmPath()
    if (!path) throw new Error("Connect 4 is not available on this network.")
    return {
        type: "vm/MsgCall",
        value: { caller, send: sendUgnot ? `${sendUgnot}ugnot` : "", pkg_path: path, func, args, max_deposit: `${MAX_DEPOSIT_UGNOT}ugnot` },
    }
}

function submit(func: Connect4Func, args: string[], caller: string, sendUgnot?: number) {
    return doContractBroadcast([buildCall(func, args, caller, sendUgnot)], `Connect 4: ${func}`, { gasWanted: GAS_WANTED })
}

export const QUICKPLAY_FALLBACK_EVENT = "memba:quickplay-fallback"
type MoveFunc = "Reveal" | "Play" | "Resign" | "ClaimTimeout"
export interface MoveOptions { viaWallet?: boolean }

// Coin-free moves sign through the Quick play session when one is active; if the
// session can't be used, the same call goes to Adena at once.
async function move(func: MoveFunc, args: string[], caller: string, opts?: MoveOptions) {
    if (!opts?.viaWallet && hasLocalSession(caller)) {
        try { return await quickPlayCall(caller, func, args) }
        catch (e) {
            if (!(e instanceof QuickPlayUnavailable)) throw e
            // Tell the UI why, without delaying the wallet call.
            window.dispatchEvent(new CustomEvent(QUICKPLAY_FALLBACK_EVENT, { detail: e.message }))
        }
    }
    return submit(func, args, caller)
}

function assertIndex(n: number) {
    if (!isIndex(n)) throw new Error("Invalid game id")
}

export async function sha256Hex(s: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Reveal keys: commitment -> passphrase, per creator. Keyed by commitment
// because the game id is unknown until the Offer lands.
const keyStore = (caller: string) => `memba.connect4.pass.${caller}`

function readKeys(caller: string): Record<string, string> {
    try {
        const v = JSON.parse(localStorage.getItem(keyStore(caller)) ?? "{}")
        return v && typeof v === "object" ? v : {}
    } catch {
        return {}
    }
}

export function revealKey(caller: string, commitment: string): string | null {
    const v = readKeys(caller)[commitment]
    return typeof v === "string" ? v : null
}

/** Posts an offer and returns its commitment. The passphrase is stored before
 * signing; if it cannot be stored nothing is sent (a lost key forfeits). */
export async function offer(caller: string, o: { stakeUgnot: number; validFor: number; opponent: string }): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const passphrase = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    const commitment = await sha256Hex(passphrase)
    let raw: string | null = null
    try { raw = localStorage.getItem(keyStore(caller)) } catch { /* unreadable: the write below reports it */ }
    if (raw !== null) {
        let v: unknown
        try { v = JSON.parse(raw) } catch { v = null }
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Your stored reveal keys look damaged, so nothing was sent.")
    }
    try {
        localStorage.setItem(keyStore(caller), JSON.stringify({ ...readKeys(caller), [commitment]: passphrase }))
    } catch {
        throw new Error("Couldn't store your reveal key on this device, so nothing was sent.")
    }
    if (revealKey(caller, commitment) !== passphrase) throw new Error("Couldn't store your reveal key on this device, so nothing was sent.")
    await submit("Offer", [o.opponent, String(o.validFor), commitment], caller, o.stakeUgnot)
    return commitment
}

export const accept = (caller: string, g: Game) => submit("Accept", [String(g.id)], caller, g.stake)

export async function reveal(caller: string, id: number, passphrase: string, opts?: MoveOptions) {
    assertIndex(id)
    return move("Reveal", [String(id), passphrase], caller, opts)
}

export async function play(caller: string, id: number, column: number, opts?: MoveOptions) {
    assertIndex(id)
    if (!Number.isInteger(column) || column < 1 || column > 7) throw new Error("Column must be 1-7")
    return move("Play", [String(id), String(column)], caller, opts)
}

export async function claimTimeout(caller: string, id: number, opts?: MoveOptions) { assertIndex(id); return move("ClaimTimeout", [String(id)], caller, opts) }
export async function resign(caller: string, id: number, opts?: MoveOptions) { assertIndex(id); return move("Resign", [String(id)], caller, opts) }
export async function cancel(caller: string, id: number) { assertIndex(id); return submit("Cancel", [String(id)], caller) }

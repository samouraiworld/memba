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
import { quickPlayCall, quickPlayOn, QuickPlayUnavailable, withQuickPlay } from "./quickPlay"

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
    /** sha256 of the acceptor's seed, given with Accept; revealed after the creator's passphrase. */
    seedCommitment: string
    /** The creator's passphrase is out: with turn 0 the game waits for the acceptor's RevealSeed. */
    revealed: boolean
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
    const strs = ["creator", "opponent", "acceptor", "commitment", "seedCommitment", "turnPlayer", "winner"]
    return nums.every((k) => typeof o[k] === "number")
        && strs.every((k) => typeof o[k] === "string")
        && typeof o.board === "string" && BOARD_RE.test(o.board)
        && (o.turn === 0 || o.turn === 1 || o.turn === 2)
        && typeof o.revealed === "boolean"
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
/** `fee` is the house fee a new offer pays, or null when the realm didn't give a valid one (then no offer can be posted). */
export async function getActive(offset: number, limit: number): Promise<{ now: number; fee: number | null; games: Game[] } | null> {
    if (!isIndex(offset) || !isIndex(limit)) return null
    const lim = Math.max(1, Math.min(100, limit))
    const v = await evalJSON(`ActiveJSON(${offset}, ${lim})`)
    if (!v) return null
    const fee = isIndex(v.fee as number) ? v.fee as number : null
    return { now: v.now as number, fee, games: Array.isArray(v.games) ? v.games.filter(isGame) : [] }
}

export interface Leader { addr: string; score: number }
/** The realm's two top-10 boards: most games won, most ugnot won. */
export interface Leaders { wins: Leader[]; gnot: Leader[] }
const ADDR_RE = /^g1[02-9ac-hj-np-z]{38}$/
const isLeader = (v: unknown): v is Leader => {
    const o = v as Record<string, unknown> | null
    return !!o && typeof o === "object" && typeof o.addr === "string" && ADDR_RE.test(o.addr) && Number.isSafeInteger(o.score) && (o.score as number) > 0
}

/** The leaderboards, highest first, at most 10 each. Null on failure. */
export async function getLeaders(): Promise<Leaders | null> {
    const path = realmPath()
    if (!path) return null
    const raw = await queryEval(GNO_RPC_URL, path, "LeadersJSON()", false).catch(() => null)
    if (!raw) return null
    const v = parseQevalJSON(raw) as Record<string, unknown> | null
    if (!v || !Array.isArray(v.wins) || !Array.isArray(v.gnot)) return null
    return { wins: v.wins.filter(isLeader).slice(0, 10), gnot: v.gnot.filter(isLeader).slice(0, 10) }
}

// WRITES

export type Connect4Func = "Offer" | "Accept" | "Reveal" | "RevealSeed" | "Play" | "ClaimTimeout" | "Resign" | "Cancel"

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

/** Who asks the wallet: doContractBroadcast by default; Memba OS passes its review sheet's (games/connect4/osWallet). */
export type Broadcast = typeof doContractBroadcast

function submit(func: Connect4Func, args: string[], caller: string, sendUgnot?: number, broadcast: Broadcast = doContractBroadcast, beforeSign?: () => Promise<void>) {
    return broadcast([buildCall(func, args, caller, sendUgnot)], `Connect 4: ${func}`, { gasWanted: GAS_WANTED, beforeSign })
}

export const QUICKPLAY_FALLBACK_EVENT = "memba:quickplay-fallback"
type MoveFunc = "Reveal" | "RevealSeed" | "Play" | "ClaimTimeout"
/** `beforeSign` runs right before the wallet opens and throws to stop (nothing is sent). */
export interface MoveOptions { viaWallet?: boolean; broadcast?: Broadcast; beforeSign?: () => Promise<void> }

// Coin-free moves sign through the Quick play session when one is active; if the
// session can't be used, the same call goes to Adena at once.
async function move(func: MoveFunc, args: string[], caller: string, opts?: MoveOptions) {
    if (!opts?.viaWallet && quickPlayOn(caller)) {
        try { return await quickPlayCall(caller, func, args) }
        catch (e) {
            if (!(e instanceof QuickPlayUnavailable)) throw e
            // Tell the UI why, without delaying the wallet call.
            window.dispatchEvent(new CustomEvent(QUICKPLAY_FALLBACK_EVENT, { detail: e.message }))
        }
    }
    return submit(func, args, caller, undefined, opts?.broadcast, opts?.beforeSign)
}

function assertIndex(n: number) {
    if (!isIndex(n)) throw new Error("Invalid game id")
}

export async function sha256Hex(s: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Reveal keys: commitment -> secret, per address: the creator's passphrase
// and the acceptor's seed alike. Keyed by commitment because the game id is
// unknown until the Offer lands.
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

/** A fresh 32-byte random secret and its commitment, stored before anything is
 * signed: if it cannot be stored nothing is sent (a lost secret forfeits). */
async function newSecret(caller: string): Promise<{ secret: string; commitment: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    const commitment = await sha256Hex(secret)
    let raw: string | null = null
    try { raw = localStorage.getItem(keyStore(caller)) } catch { /* unreadable: the write below reports it */ }
    if (raw !== null) {
        let v: unknown
        try { v = JSON.parse(raw) } catch { v = null }
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Your stored reveal keys look damaged, so nothing was sent.")
    }
    try {
        localStorage.setItem(keyStore(caller), JSON.stringify({ ...readKeys(caller), [commitment]: secret }))
    } catch {
        throw new Error("Couldn't store your reveal key on this device, so nothing was sent.")
    }
    if (revealKey(caller, commitment) !== secret) throw new Error("Couldn't store your reveal key on this device, so nothing was sent.")
    return { secret, commitment }
}

/** Posts an offer and returns its commitment. `maxFeeUgnot` is the fee the creator was shown: the realm refuses the offer if the fee is now higher. */
/** `quickPlay`: the player's consent, shown at the stake, to start Quick play in the same approval. */
export async function offer(caller: string, o: { stakeUgnot: number; validFor: number; opponent: string; maxFeeUgnot: number }, broadcast?: Broadcast, quickPlay = true): Promise<string> {
    if (!isIndex(o.maxFeeUgnot)) throw new Error("The house fee isn't known yet, so nothing was sent.")
    const { commitment } = await newSecret(caller)
    // The same approval starts Quick play unless the player signs every move (see withQuickPlay).
    await submit("Offer", [o.opponent, String(o.validFor), commitment, String(o.maxFeeUgnot)], caller, o.stakeUgnot, withQuickPlay(caller, o.stakeUgnot, broadcast, quickPlay))
    return commitment
}

/** Accepts with the commitment of a fresh seed, revealed after the creator's passphrase (revealSeed). */
export async function accept(caller: string, g: Game, broadcast?: Broadcast, quickPlay = true) {
    const { commitment } = await newSecret(caller)
    return submit("Accept", [String(g.id), commitment], caller, g.stake, withQuickPlay(caller, g.stake, broadcast, quickPlay))
}

export async function reveal(caller: string, id: number, passphrase: string, opts?: MoveOptions) {
    assertIndex(id)
    return move("Reveal", [String(id), passphrase], caller, opts)
}

export async function revealSeed(caller: string, id: number, seed: string, opts?: MoveOptions) {
    assertIndex(id)
    return move("RevealSeed", [String(id), seed], caller, opts)
}

/** `moves` is the game's move count when the player chose: the realm refuses the move once the game is past it. */
export async function play(caller: string, id: number, column: number, moves: number, opts?: MoveOptions) {
    assertIndex(id)
    assertIndex(moves)
    if (!Number.isInteger(column) || column < 1 || column > 7) throw new Error("Column must be 1-7")
    return move("Play", [String(id), String(column), String(moves)], caller, opts)
}

export async function claimTimeout(caller: string, id: number, opts?: MoveOptions) { assertIndex(id); return move("ClaimTimeout", [String(id)], caller, opts) }
// The realm refuses Resign from a Quick play session (a stolen key must not throw games), so it always asks the wallet.
export async function resign(caller: string, id: number, broadcast?: Broadcast) { assertIndex(id); return submit("Resign", [String(id)], caller, undefined, broadcast) }
export async function cancel(caller: string, id: number, broadcast?: Broadcast) { assertIndex(id); return submit("Cancel", [String(id)], caller, undefined, broadcast) }

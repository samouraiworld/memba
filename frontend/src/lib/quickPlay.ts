/**
 * quickPlay.ts — Connect 4 "Quick play": a gno account session (tm2 auth
 * sessions) whose key lives in this browser, so coin-free moves sign without a
 * wallet popup. Adena creates and revokes the session; Offer/Accept/Cancel
 * never come here. See docs/superpowers/specs/2026-10-02-connect4-quickplay-design.md.
 */
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GNO_RPC_URL, connect4PathFor } from "./config"
import { accountMark, accountMarkAfterBlocks } from "../os/sign/accountMark"
import { ChainRejectedError, NothingSentError, WalletRefusedError, doContractBroadcast, type AminoMsg, feeForGasWanted, networkGasPrice, walletActionTicket } from "./grc20"
import { keyFromPriv, newSessionKey, pubKeyAnyBytes, signSessionTx, type SessionKey } from "./sessionTx"
import { broadcastSignedTx, CheckTxError, RealmError } from "./signedTxBroadcast"
import { ugnotInCoinsJson } from "./bankBalance"

export const QUICKPLAY_DURATIONS = [3600, 14400, 86400] as const
export type QuickPlayDuration = (typeof QUICKPLAY_DURATIONS)[number]
export const QUICKPLAY_LABEL: Record<QuickPlayDuration, string> = { 3600: "1h", 14400: "4h", 86400: "24h" }
const SPEND_LIMIT_UGNOT = 5_000_000
const SPEND_PERIOD = 86_400
const GAS_WANTED = 20_000_000
const MAX_DEPOSIT = "2000000ugnot"
const FUNCS = new Set(["Reveal", "RevealSeed", "Play", "ClaimTimeout"])

export interface QuickPlayStatus { expiresAt: number; spendUsedUgnot: number; spendLimitUgnot: number }
export class QuickPlayUnavailable extends Error {
    name = "QuickPlayUnavailable"
    constructor(readonly reason: "ended" | "budget" | "rejected", message: string) { super(message) }
}

// sentAt: when the create was broadcast. Until PENDING_GRACE_MS later, "not on chain" means the
// node hasn't caught up yet — never a reason to drop the key (that orphans a live session).
interface Stored { priv: string; sessionAddr: string; allowPath: string; chainId: string; sentAt?: number }
const PENDING_GRACE_MS = 120_000
const CONFIRM_TRIES = 8
const CONFIRM_DELAY_MS = 1_500
const MARK_READ_MS = 3_000
const young = (s: Stored) => typeof s.sentAt === "number" && Date.now() - s.sentAt < PENDING_GRACE_MS
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const storageKey = (master: string) => `memba.quickplay.${ACTIVE_NETWORK_KEY}.${master}`
const allowPath = () => { const p = connect4PathFor(ACTIVE_NETWORK_KEY); return p ? `vm/exec:${p}` : null }
const MAX_SESSIONS = 16
const MASTER_RE = /^g1[02-9ac-hj-np-z]{38}$/
const checkMaster = (m: string) => { if (!MASTER_RE.test(m)) throw new Error("Invalid account address") }
class SessionReadError extends Error { name = "SessionReadError" }
const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16))
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

function read(master: string): (Stored & { key: SessionKey }) | null {
    try {
        const raw = localStorage.getItem(storageKey(master))
        if (!raw) return null
        const s = JSON.parse(raw) as Stored
        if (s.chainId !== GNO_CHAIN_ID || s.allowPath !== allowPath() || !/^[0-9a-f]{64}$/.test(s.priv)) return null
        const key = keyFromPriv(fromHex(s.priv))
        return key.address === s.sessionAddr ? { ...s, key } : null
    } catch { return null }
}
function remove(master: string) { try { localStorage.removeItem(storageKey(master)) } catch { /* nothing stored */ } }
const markSent = (master: string, entry: Stored) => { try { localStorage.setItem(storageKey(master), JSON.stringify({ ...entry, sentAt: Date.now() })) } catch { /* key already stored */ } }
// Accounts whose Start is waiting on the wallet: their stored key isn't a session yet, and a status read must not drop it.
const starting = new Set<string>()
const local = (master: string) => (starting.has(master) ? null : read(master))

export function hasLocalSession(master: string): boolean { return local(master) !== null }
// "Sign every transaction" (Advanced): moves go through the wallet even with a session key here.
const SIGN_EACH_KEY = "memba.quickplay.signEach"
export function signEachMove(): boolean { try { return localStorage.getItem(SIGN_EACH_KEY) === "1" } catch { return false } }
export function setSignEachMove(on: boolean): void { try { if (on) localStorage.setItem(SIGN_EACH_KEY, "1"); else localStorage.removeItem(SIGN_EACH_KEY) } catch { /* stays as it was */ } }
// The session length picked under Advanced; a session bundled into Offer/Accept uses it too.
const DURATION_KEY = "memba.quickplay.duration"
export function quickPlayDuration(): QuickPlayDuration {
    try { const d = Number(localStorage.getItem(DURATION_KEY)); return QUICKPLAY_DURATIONS.find((x) => x === d) ?? 14400 } catch { return 14400 }
}
export function setQuickPlayDuration(d: QuickPlayDuration): void { try { localStorage.setItem(DURATION_KEY, String(d)) } catch { /* default next time */ } }
/** Moves sign with the session key: one is here and the player hasn't asked to sign each one. */
export function quickPlayOn(master: string): boolean { return !signEachMove() && hasLocalSession(master) }
export function forgetQuickPlay(master: string): void { remove(master) }

interface ChainSession { accountNumber: string; sequence: string; status: QuickPlayStatus; allowPaths: string[] }
async function abciData(path: string): Promise<unknown | null> {
    try {
        const res = await fetch(`${GNO_RPC_URL}/abci_query?path=%22${path}%22`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (body?.error) throw new Error("RPC error")
        const base = body?.result?.response?.ResponseBase
        if (!base || typeof base !== "object") throw new Error("malformed response")
        // Only the chain's own "no such session" means absent; any other error is a failed read.
        if (base.Error) {
            if (base.Error["@type"] === "/std.SessionNotFoundError") return null
            throw new Error("query failed")
        }
        if (typeof base.Data !== "string") throw new Error("malformed response")
        return JSON.parse(atob(base.Data))
    } catch (e) { throw new SessionReadError(e instanceof Error ? e.message : "read failed") }
}
async function chainSession(master: string, sessionAddr: string): Promise<ChainSession | null> {
    const d = (await abciData(`auth/accounts/${master}/session/${sessionAddr}`)) as { BaseSessionAccount?: Record<string, any>; allow_paths?: unknown } | null // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!d) return null
    const s = d.BaseSessionAccount
    if (!s?.BaseAccount) throw new SessionReadError("malformed session")
    const ugnot = (c: string | undefined) => Number(/^(\d+)ugnot$/.exec(c ?? "")?.[1] ?? 0)
    const reset = Number(s.spend_reset ?? 0), period = Number(s.spend_period ?? 0)
    const used = period > 0 && Date.now() / 1000 >= reset + period ? 0 : ugnot(s.spend_used)
    return {
        accountNumber: String(s.BaseAccount.account_number), sequence: String(s.BaseAccount.sequence),
        status: { expiresAt: Number(s.expires_at), spendUsedUgnot: used, spendLimitUgnot: ugnot(s.spend_limit) },
        allowPaths: Array.isArray(d.allow_paths) ? d.allow_paths : [],
    }
}

/** The daily budget: 5 GNOT, or what the balance holds after the stake when that's lower. */
export function quickPlayBudget(balanceUgnot: bigint, stakeUgnot = 0): number {
    const left = balanceUgnot - BigInt(stakeUgnot)
    return Number(left <= 0n ? 0n : left < BigInt(SPEND_LIMIT_UGNOT) ? left : BigInt(SPEND_LIMIT_UGNOT))
}
/** A failed balance read keeps 5 GNOT, stake not taken off: it's only a cap. */
async function spendLimit(master: string, stakeUgnot: number): Promise<number> {
    let balance: bigint
    try {
        const coins = await abciData(`bank/balances/${master}`)
        balance = ugnotInCoinsJson(JSON.stringify(coins))
    } catch { return SPEND_LIMIT_UGNOT }
    return quickPlayBudget(balance, stakeUgnot)
}

const sessionKeyAny = (pub33b64: string) => ({ type_url: "/tm.PubKeySecp256k1", value: b64(Uint8Array.from([0x0a, 0x21, ...Uint8Array.from(atob(pub33b64), (c) => c.charCodeAt(0))])) })
/** Own-path sessions already expired (never pruned by the chain) + total count; null if the list can't be read. */
async function sessionSlots(master: string, path: string): Promise<{ total: number; stale: string[] } | null> {
    try {
        const list = await abciData(`auth/accounts/${master}/sessions`)
        if (list === null) return { total: 0, stale: [] }
        if (!Array.isArray(list)) return null
        const now = Date.now() / 1000, stale: string[] = []
        for (const e of list) {
            const key = e?.BaseSessionAccount?.BaseAccount?.public_key?.value
            const ap = e?.allow_paths
            if (typeof key === "string" && /^[A-Za-z0-9+/]{44}$/.test(key) && Array.isArray(ap) && ap.length === 1 && ap[0] === path && Number(e.BaseSessionAccount.expires_at) <= now) stale.push(key)
        }
        return { total: list.length, stale }
    } catch { return null }
}

/** Thrown before anything is sent: a bundled Offer/Accept then goes out without a session. */
class SessionPrepError extends Error { name = "SessionPrepError" }
interface Bundle { msgs: AminoMsg[]; memo: string; opts?: BroadcastOpts; sendUgnot: number }
type BroadcastOpts = Parameters<typeof doContractBroadcast>[2]

/**
 * Stores a fresh key and sends its create-session (after any revokes, then `bundle`'s messages)
 * in one wallet approval. `renew` replaces the session here: the chain can't top one up.
 */
async function sendSession(master: string, duration: QuickPlayDuration, broadcast: typeof doContractBroadcast, renew: boolean, bundle?: Bundle) {
    checkMaster(master)
    const old = renew ? local(master) : null
    if (starting.has(master) || (!renew && hasLocalSession(master))) throw new SessionPrepError("Quick play is already on — end it first.")
    if (renew && !old) throw new SessionPrepError("There's no Quick play session to renew.")
    if (!QUICKPLAY_DURATIONS.includes(duration)) throw new SessionPrepError("Unsupported Quick play duration")
    const path = allowPath()
    if (!path) throw new SessionPrepError("Connect 4 is not available on this network.")
    const limit = await spendLimit(master, bundle?.sendUgnot ?? 0)
    if (limit < feeForGasWanted(GAS_WANTED, await networkGasPrice())) throw new SessionPrepError("Not enough GNOT to pay for Quick play moves, so nothing was sent.")
    const slots = await sessionSlots(master, path)
    // Unknown count: a bundle hitting the 16-session cap would sink the stake with it.
    if (!slots && bundle) throw new SessionPrepError("Couldn't count this account's sessions.")
    if (slots && slots.total - slots.stale.length >= MAX_SESSIONS) throw new SessionPrepError("This account already has 16 sessions. Revoke some in your wallet, then try again.")
    const key = newSessionKey()
    const expiresAt = Math.floor(Date.now() / 1000) + duration
    const entry: Stored = { priv: toHex(key.priv), sessionAddr: key.address, allowPath: path, chainId: GNO_CHAIN_ID }
    const noStore = "Couldn't store the Quick play key on this device, so nothing was sent."
    try { localStorage.setItem(storageKey(master), JSON.stringify(entry)) } catch { throw new SessionPrepError(noStore) }
    // A failed renew puts the old key back: its session is still live.
    const drop = () => { if (old) markSent(master, old); else remove(master) }
    if (!read(master)) { drop(); throw new SessionPrepError(noStore) }
    starting.add(master)
    // Set right before the wallet request: from then on a failure may still have landed.
    let sent = false
    // The account before the wallet opens, to tell a real "rejected" from one Adena gives after Confirm.
    let before: string | null = null
    try {
        const oldKey = old ? [b64(old.key.pub)] : []
        const revokes = [...oldKey, ...(slots?.stale ?? []).filter((k) => !oldKey.includes(k))].map((k) => ({ type: "/auth.m_revoke_session", value: { creator: master, session_key: sessionKeyAny(k) } }))
        const callerBeforeSign = bundle?.opts?.beforeSign
        const res = await broadcast([...revokes, { type: "/auth.m_create_session", value: {
            creator: master,
            session_key: { type_url: "/tm.PubKeySecp256k1", value: b64(pubKeyAnyBytes(key.pub).slice(-35)) },
            expires_at: String(expiresAt), allow_paths: [path], spend_limit: `${limit}ugnot`, spend_period: String(SPEND_PERIOD),
        } }, ...(bundle?.msgs ?? [])], bundle?.memo ?? (old ? "Renew Quick play" : "Start Quick play"), { ...bundle?.opts, beforeSign: async () => {
            const gate = await callerBeforeSign?.()
            before = await Promise.race([accountMark(master).catch(() => null), sleep(MARK_READ_MS).then(() => null)])
            return () => { if (typeof gate === "function" && !gate()) return false; sent = true; return true }
        } })
        markSent(master, entry)
        return { key, res }
    } catch (e) {
        if (!sent || e instanceof ChainRejectedError || e instanceof NothingSentError) { drop(); throw e }
        // "Rejected" after the wallet opened counts only when the account is unchanged a few blocks later.
        if (e instanceof WalletRefusedError && before !== null && await accountMarkAfterBlocks(master).catch(() => null) === before) { drop(); throw e }
        // The wallet may have sent it: keep the key as pending; the status read settles it by session address.
        markSent(master, entry)
        if (bundle) throw e
        throw new Error("Your wallet didn't say whether Quick play started — Memba keeps checking for it.")
    } finally { starting.delete(master) }
}

/** `broadcast`: who asks the wallet (Memba OS passes its review sheet's). `renew`: see sendSession. */
export async function startQuickPlay(master: string, duration: QuickPlayDuration, broadcast: typeof doContractBroadcast = doContractBroadcast, renew = false): Promise<QuickPlayStatus> {
    let key: SessionKey
    try { ({ key } = await sendSession(master, duration, broadcast, renew)) }
    catch (e) { throw e instanceof SessionPrepError ? new Error(e.message) : e }
    // From here the key is kept even if the reads fail. Memba's node can be a block or two behind
    // the wallet's, so wait for the session to show up before giving up.
    for (let i = 0; i < CONFIRM_TRIES; i++) {
        try {
            const s = await chainSession(master, key.address)
            if (s) return s.status
        } catch { /* keep waiting */ }
        if (i < CONFIRM_TRIES - 1) await sleep(CONFIRM_DELAY_MS)
    }
    throw new Error("Quick play was sent but isn't confirmed yet — it will show up shortly.")
}

/**
 * Wraps a broadcast so a staking call (Offer/Accept) also starts a Quick play session in the
 * same approval when `enabled` (the player's consent at the stake) — unless the player signs every
 * move, a session is already here, or one can't be set up (then the call goes out alone).
 */
export function withQuickPlay(master: string, sendUgnot: number, broadcast: typeof doContractBroadcast = doContractBroadcast, enabled = true): typeof doContractBroadcast {
    return async (msgs, memo, opts) => {
        if (!enabled || signEachMove() || hasLocalSession(master) || starting.has(master)) return broadcast(msgs, memo, opts)
        try { return (await sendSession(master, quickPlayDuration(), broadcast, false, { msgs, memo, opts, sendUgnot })).res }
        catch (e) { if (e instanceof SessionPrepError) return broadcast(msgs, memo, opts); throw e }
    }
}

/** Throws (key kept) on transport/parse failure; null means no session; "pending" means just sent, not on chain yet. */
export async function quickPlayStatus(master: string): Promise<QuickPlayStatus | "pending" | null> {
    checkMaster(master)
    const mine = local(master)
    if (!mine) return null
    const s = await chainSession(master, mine.sessionAddr)
    if (!s && young(mine)) return "pending"
    if (!s || s.status.expiresAt <= Date.now() / 1000) { remove(master); return null }
    return s.status
}

export async function quickPlayCall(master: string, func: "Reveal" | "RevealSeed" | "Play" | "ClaimTimeout", args: string[]): Promise<{ hash: string }> {
    checkMaster(master)
    if (!FUNCS.has(func)) throw new Error(`Quick play can't sign ${func}`)
    // Signed without the wallet, so the OS session that started the move is checked here instead.
    const stillAllowed = walletActionTicket()
    // Backstop for move(): the player chose to sign every move in the wallet.
    if (signEachMove()) throw new QuickPlayUnavailable("rejected", "Quick play is paused — confirm in your wallet.")
    const mine = local(master)
    if (!mine) throw new QuickPlayUnavailable("ended", "Quick play isn't on for this account.")
    const fee = feeForGasWanted(GAS_WANTED, await networkGasPrice())
    for (let attempt = 0; attempt < 2; attempt++) {
        let s: ChainSession | null
        try { s = await chainSession(master, mine.sessionAddr) }
        catch { throw new QuickPlayUnavailable("rejected", "Couldn't read the Quick play session — confirm in your wallet.") }
        if (!s && young(mine)) throw new QuickPlayUnavailable("rejected", "Quick play is still confirming — confirm in your wallet.")
        if (!s || s.status.expiresAt <= Date.now() / 1000) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
        if (!s.allowPaths.includes(mine.allowPath)) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
        if (s.status.spendUsedUgnot + fee > s.status.spendLimitUgnot) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
        stillAllowed()
        const bytes = signSessionTx({
            key: mine.key, chainId: GNO_CHAIN_ID, accountNumber: s.accountNumber, sequence: s.sequence, gas: GAS_WANTED, feeUgnot: fee,
            memo: `Connect 4: ${func}`,
            msg: { caller: master, send: "", max_deposit: MAX_DEPOSIT, pkg_path: mine.allowPath.slice("vm/exec:".length), func, args },
        })
        try { return await broadcastSignedTx(GNO_CHAIN_ID, bytes, stillAllowed) }
        catch (e) {
            // DeliverTx budget exhaustion (storage deposit lock) rolls the move back, so the wallet may resend.
            if (e instanceof RealmError && /session spend limit/i.test(e.message)) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
            if (!(e instanceof CheckTxError)) throw e
            if (/session expired/i.test(e.message) || (/unknown session|session not found/i.test(e.message) && !young(mine))) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
            if (/spend limit|exceeds.*limit|not allowed/i.test(e.message)) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
            if (attempt === 1) throw new QuickPlayUnavailable("rejected", e.message)
        }
    }
    throw new QuickPlayUnavailable("rejected", "Quick play couldn't sign this move.")
}

export async function endQuickPlay(master: string, broadcast: typeof doContractBroadcast = doContractBroadcast): Promise<void> {
    checkMaster(master)
    const mine = local(master)
    if (!mine) return
    await broadcast([{ type: "/auth.m_revoke_session", value: { creator: master, session_key: { type_url: "/tm.PubKeySecp256k1", value: b64(pubKeyAnyBytes(mine.key.pub).slice(-35)) } } }], "End Quick play")
    remove(master)
}

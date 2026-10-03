/**
 * quickPlay.ts — Connect 4 "Quick play": a gno account session (tm2 auth
 * sessions) whose key lives in this browser, so coin-free moves sign without a
 * wallet popup. Adena creates and revokes the session; Offer/Accept/Cancel
 * never come here. See docs/superpowers/specs/2026-10-02-connect4-quickplay-design.md.
 */
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GNO_RPC_URL, connect4PathFor } from "./config"
import { doContractBroadcast, feeForGasWanted, networkGasPrice } from "./grc20"
import { keyFromPriv, newSessionKey, pubKeyAnyBytes, signSessionTx, type SessionKey } from "./sessionTx"
import { broadcastSignedTx, CheckTxError, RealmError } from "./signedTxBroadcast"

export const QUICKPLAY_DURATIONS = [3600, 14400, 86400] as const
export type QuickPlayDuration = (typeof QUICKPLAY_DURATIONS)[number]
const SPEND_LIMIT_UGNOT = 1_000_000
const SPEND_PERIOD = 86_400
const GAS_WANTED = 20_000_000
const MAX_DEPOSIT = "2000000ugnot"
const FUNCS = new Set(["Reveal", "Play", "Resign", "ClaimTimeout"])

export interface QuickPlayStatus { expiresAt: number; spendUsedUgnot: number; spendLimitUgnot: number }
export class QuickPlayUnavailable extends Error {
    name = "QuickPlayUnavailable"
    constructor(readonly reason: "ended" | "budget" | "rejected", message: string) { super(message) }
}

interface Stored { priv: string; sessionAddr: string; allowPath: string; chainId: string }
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

export function hasLocalSession(master: string): boolean { return read(master) !== null }
export function forgetQuickPlay(master: string): void { remove(master) }

interface ChainSession { accountNumber: string; sequence: string; status: QuickPlayStatus; allowPaths: string[] }
async function abciData(path: string): Promise<unknown | null> {
    try {
        const res = await fetch(`${GNO_RPC_URL}/abci_query?path=%22${path}%22`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const base = (await res.json())?.result?.response?.ResponseBase
        if (!base?.Data) return null
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

export async function startQuickPlay(master: string, duration: QuickPlayDuration): Promise<QuickPlayStatus> {
    checkMaster(master)
    if (hasLocalSession(master)) throw new Error("Quick play is already on — end it first.")
    if (!QUICKPLAY_DURATIONS.includes(duration)) throw new Error("Unsupported Quick play duration")
    const path = allowPath()
    if (!path) throw new Error("Connect 4 is not available on this network.")
    const key = newSessionKey()
    const expiresAt = Math.floor(Date.now() / 1000) + duration
    const entry: Stored = { priv: toHex(key.priv), sessionAddr: key.address, allowPath: path, chainId: GNO_CHAIN_ID }
    try { localStorage.setItem(storageKey(master), JSON.stringify(entry)) } catch { throw new Error("Couldn't store the Quick play key on this device, so nothing was sent.") }
    if (!hasLocalSession(master)) throw new Error("Couldn't store the Quick play key on this device, so nothing was sent.")
    try {
        const slots = await sessionSlots(master, path)
        if (slots && slots.total - slots.stale.length >= MAX_SESSIONS) throw new Error("This account already has 16 sessions. Revoke some in your wallet, then try again.")
        const revokes = (slots?.stale ?? []).map((k) => ({ type: "/auth.m_revoke_session", value: { creator: master, session_key: sessionKeyAny(k) } }))
        await doContractBroadcast([...revokes, { type: "/auth.m_create_session", value: {
            creator: master,
            session_key: { type_url: "/tm.PubKeySecp256k1", value: b64(pubKeyAnyBytes(key.pub).slice(-35)) },
            expires_at: String(expiresAt), allow_paths: [path], spend_limit: `${SPEND_LIMIT_UGNOT}ugnot`, spend_period: String(SPEND_PERIOD),
        } }], "Start Quick play")
    } catch (e) { remove(master); throw e }
    // The broadcast landed: from here the key is kept even if the read fails. quickPlayStatus/
    // quickPlayCall drop it once the chain says there is no session; hasLocalSession blocks a second Start.
    const pending = new Error("Quick play was sent but isn't confirmed yet — it will show up shortly.")
    let s: ChainSession | null
    try { s = await chainSession(master, key.address) } catch { throw pending }
    if (!s) throw pending
    return s.status
}

/** Throws (key kept) on transport/parse failure; null means the chain has no such session. */
export async function quickPlayStatus(master: string): Promise<QuickPlayStatus | null> {
    checkMaster(master)
    const local = read(master)
    if (!local) return null
    const s = await chainSession(master, local.sessionAddr)
    if (!s || s.status.expiresAt <= Date.now() / 1000) { remove(master); return null }
    return s.status
}

export async function quickPlayCall(master: string, func: "Reveal" | "Play" | "Resign" | "ClaimTimeout", args: string[]): Promise<{ hash: string }> {
    checkMaster(master)
    if (!FUNCS.has(func)) throw new Error(`Quick play can't sign ${func}`)
    const local = read(master)
    if (!local) throw new QuickPlayUnavailable("ended", "Quick play isn't on for this account.")
    const fee = feeForGasWanted(GAS_WANTED, await networkGasPrice())
    for (let attempt = 0; attempt < 2; attempt++) {
        let s: ChainSession | null
        try { s = await chainSession(master, local.sessionAddr) }
        catch { throw new QuickPlayUnavailable("rejected", "Couldn't read the Quick play session — confirm in your wallet.") }
        if (!s || s.status.expiresAt <= Date.now() / 1000) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
        if (!s.allowPaths.includes(local.allowPath)) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
        if (s.status.spendUsedUgnot + fee > s.status.spendLimitUgnot) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
        const bytes = signSessionTx({
            key: local.key, chainId: GNO_CHAIN_ID, accountNumber: s.accountNumber, sequence: s.sequence, gas: GAS_WANTED, feeUgnot: fee,
            memo: `Connect 4: ${func}`,
            msg: { caller: master, send: "", max_deposit: MAX_DEPOSIT, pkg_path: local.allowPath.slice("vm/exec:".length), func, args },
        })
        try { return await broadcastSignedTx(GNO_CHAIN_ID, bytes) }
        catch (e) {
            // DeliverTx budget exhaustion (storage deposit lock) rolls the move back, so the wallet may resend.
            if (e instanceof RealmError && /session spend limit/i.test(e.message)) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
            if (!(e instanceof CheckTxError)) throw e
            if (/session expired|unknown session|session not found/i.test(e.message)) { remove(master); throw new QuickPlayUnavailable("ended", "Quick play ended — confirm in your wallet.") }
            if (/spend limit|exceeds.*limit|not allowed/i.test(e.message)) throw new QuickPlayUnavailable("budget", "Quick play budget used up for today.")
            if (attempt === 1) throw new QuickPlayUnavailable("rejected", e.message)
        }
    }
    throw new QuickPlayUnavailable("rejected", "Quick play couldn't sign this move.")
}

export async function endQuickPlay(master: string): Promise<void> {
    checkMaster(master)
    const local = read(master)
    if (!local) return
    await doContractBroadcast([{ type: "/auth.m_revoke_session", value: { creator: master, session_key: { type_url: "/tm.PubKeySecp256k1", value: b64(pubKeyAnyBytes(local.key.pub).slice(-35)) } } }], "End Quick play")
    remove(master)
}

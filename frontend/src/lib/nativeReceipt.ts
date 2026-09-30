import { sha256 } from "@noble/hashes/sha2.js"
import type { Transaction } from "../gen/memba/v1/memba_pb"

const eventName = "memba-native-receipt"
const volatileReceipts = new Map<string, string>()
export const validReceiptHash = (hash: string): boolean => /^[0-9a-f]{64}$/i.test(hash)

// A receipt is only a retry hint, never proof of execution. Scope it to the
// backend, viewer, wallet, chain and immutable proposal (not merely a DB ID).
export function nativeReceiptKey(tx: Transaction, viewer: string, backend: string): string {
    const scope = JSON.stringify([backend, viewer, tx.chainId, tx.multisigAddress, tx.id, tx.accountNumber, tx.sequence, tx.msgsJson, tx.feeJson, tx.memo])
    return "memba:native-receipt:v1:" + Array.from(sha256(new TextEncoder().encode(scope)), b => b.toString(16).padStart(2, "0")).join("")
}

export function readNativeReceipt(key: string): string {
    if (!key) return ""
    if (volatileReceipts.has(key)) return volatileReceipts.get(key)!
    try {
        return localStorage.getItem(key) ?? ""
    } catch {
        return "Recovery storage is unavailable"
    }
}

export function subscribeNativeReceipts(notify: () => void): () => void {
    // A different tab clearing storage must not erase this tab's last known
    // successful hash when persistence failed. Only reconciliation clears it.
    const onStorage = () => notify()
    window.addEventListener("storage", onStorage)
    window.addEventListener(eventName, notify)
    return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(eventName, notify)
    }
}

export function assertReceiptStorage(key: string): void {
    // Fail before broadcasting when reload recovery cannot be persisted.
    const probe = `${key}:probe`
    try {
        localStorage.setItem(probe, "1")
        if (localStorage.getItem(probe) !== "1") throw new Error("Storage did not persist")
        localStorage.removeItem(probe)
    } catch {
        throw new Error("Enable browser storage before broadcasting so the receipt can be recovered after a reload")
    }
}

export function saveNativeReceipt(key: string, hash: string): boolean {
    if (!validReceiptHash(hash)) throw new Error("Invalid native transaction hash")
    // If storage fails after broadcast, retain the hash for this tab's retry.
    volatileReceipts.set(key, hash)
    let persisted = false
    try {
        localStorage.setItem(key, hash)
        persisted = localStorage.getItem(key) === hash
        if (persisted) volatileReceipts.delete(key)
    } catch { /* caller warns to copy the hash before leaving */ }
    window.dispatchEvent(new Event(eventName))
    return persisted
}

export function clearNativeReceipt(key: string): void {
    try {
        localStorage.removeItem(key)
        localStorage.removeItem(`${key}:sent`)
        volatileReceipts.delete(key)
    } catch { /* keep recovery information rather than risk another broadcast */ }
    window.dispatchEvent(new Event(eventName))
}

/**
 * Two earlier broadcasts are remembered. Each one is a question to the backend
 * on the next attempt, and those questions share a limit of ten calls a minute
 * with signing: two stored hashes, today's and the completion keep one press
 * at four calls. More than two lost replies with a new signature between each
 * is not a sequence that happens.
 */
const MAX_ATTEMPTS = 2

/**
 * The hashes this browser has handed to the network for a proposal, newest
 * last. One more signature changes the transaction's bytes, so after a
 * broadcast whose reply was lost the executed transaction may no longer be the
 * one the backend assembles today: these are the hashes to ask about. Hints,
 * never proof. They are removed when this browser reconciles the proposal, and
 * stay (two hashes at most) when another member does.
 */
export function readBroadcastAttempts(key: string): string[] {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(`${key}:sent`) ?? "[]")
        return Array.isArray(saved) ? saved.filter((h): h is string => typeof h === "string" && validReceiptHash(h)).slice(-MAX_ATTEMPTS) : []
    } catch {
        return []
    }
}

export function saveBroadcastAttempt(key: string, hash: string): void {
    if (!validReceiptHash(hash)) throw new Error("Invalid native transaction hash")
    const attempts = [...readBroadcastAttempts(key).filter((h) => h !== hash), hash].slice(-MAX_ATTEMPTS)
    // Best effort: if this write fails and the reply is then lost, nothing reports it, and the
    // transaction is recognised next time only while its bytes are unchanged.
    try { localStorage.setItem(`${key}:sent`, JSON.stringify(attempts)) } catch { /* see above */ }
}

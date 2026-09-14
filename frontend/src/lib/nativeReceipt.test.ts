import { afterEach, describe, expect, it, vi } from "vitest"
import { assertReceiptStorage, clearNativeReceipt, nativeReceiptKey, readNativeReceipt, saveNativeReceipt, subscribeNativeReceipts, validReceiptHash } from "./nativeReceipt"
import type { Transaction } from "../gen/memba/v1/memba_pb"

const tx = { id: 7, chainId: "local", multisigAddress: "g1wallet", accountNumber: 1, sequence: 2, msgsJson: "[]", feeJson: "{}", memo: "" } as Transaction
const key = nativeReceiptKey(tx, "viewer", "backend")
const hash = "B".repeat(64)
afterEach(() => { vi.restoreAllMocks(); clearNativeReceipt(key) })

describe("native receipt hints", () => {
    it("scopes recovery to backend, viewer, chain, wallet and immutable proposal", () => {
        expect(nativeReceiptKey(tx, "other", "backend")).not.toBe(key)
        expect(nativeReceiptKey(tx, "viewer", "other")).not.toBe(key)
        for (const overrides of [{ id: 8 }, { chainId: "other" }, { multisigAddress: "other" }, { accountNumber: 2 }, { sequence: 3 }, { msgsJson: "other" }, { feeJson: "other" }, { memo: "other" }]) {
            expect(nativeReceiptKey({ ...tx, ...overrides }, "viewer", "backend")).not.toBe(key)
        }
    })
    it("persists only a validated hash and clears it after server reconciliation", () => {
        assertReceiptStorage(key)
        expect(saveNativeReceipt(key, hash)).toBe(true)
        expect(localStorage.getItem(key)).toBe(hash)
        expect(readNativeReceipt(key)).toBe(hash)
        clearNativeReceipt(key)
        expect(readNativeReceipt(key)).toBe("")
        expect(() => saveNativeReceipt(key, "bogus")).toThrow()
    })
    it("does not turn corrupted or unavailable storage into permission to rebroadcast", () => {
        localStorage.setItem(key, "bogus")
        expect(readNativeReceipt(key)).toBeTruthy()
        expect(validReceiptHash(readNativeReceipt(key))).toBe(false)
        vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
        expect(readNativeReceipt(key)).toBeTruthy()
        expect(readNativeReceipt("")).toBe("")
    })
    it("notifies this tab and other tabs, and removes listeners on unsubscribe", () => {
        const notify = vi.fn()
        const unsubscribe = subscribeNativeReceipts(notify)
        saveNativeReceipt(key, hash)
        window.dispatchEvent(new StorageEvent("storage", { key }))
        expect(notify).toHaveBeenCalledTimes(2)
        unsubscribe()
        clearNativeReceipt(key)
        expect(notify).toHaveBeenCalledTimes(2)
    })
    it("retains a volatile fallback when post-broadcast storage stops working", () => {
        vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        expect(saveNativeReceipt(key, hash)).toBe(false)
        expect(readNativeReceipt(key)).toBe(hash)
        expect(() => assertReceiptStorage(key)).toThrow(/Enable browser storage/)
    })
})

/**
 * A Safe creation that was sent but not yet confirmed, kept for this browser
 * tab (sessionStorage) so that closing the window or reloading resumes
 * "Check again" with the same plan and hash instead of planning a new Safe
 * (a new salt would be a second Safe and a second fee). Storage may be
 * refused: then it is kept for this page only.
 *
 * @module os/multisig/evm/pendingCreation
 */
import type { NewSafePlan } from "../../../lib/chain/evm/safe/create"
import type { Hex } from "../../../lib/chain/evm/safe/known"

export interface PendingCreation {
    plan: NewSafePlan
    hash: Hex
    display: Record<string, string>
}

const key = (chainId: number) => `memba.safe.creating.${chainId}`
const HEX = /^0x[0-9a-f]*$/

export function savePendingCreation(p: PendingCreation): void {
    const json = JSON.stringify({ ...p, plan: { ...p.plan, saltNonce: p.plan.saltNonce.toString(), tx: { ...p.plan.tx, value: p.plan.tx.value.toString() } } })
    try { sessionStorage.setItem(key(p.plan.chainId), json) } catch { /* kept for this page only */ }
}

export function loadPendingCreation(chainId: number): PendingCreation | null {
    let raw: string | null
    try { raw = sessionStorage.getItem(key(chainId)) } catch { return null }
    if (!raw) return null
    try {
        const v = JSON.parse(raw)
        const plan: NewSafePlan = { ...v.plan, saltNonce: BigInt(v.plan.saltNonce), tx: { ...v.plan.tx, value: BigInt(v.plan.tx.value) } }
        if (plan.chainId !== chainId || !HEX.test(v.hash) || !HEX.test(plan.predicted) || !Array.isArray(plan.owners)) return null
        return { plan, hash: v.hash, display: v.display ?? {} }
    } catch {
        return null
    }
}

export function clearPendingCreation(chainId: number): void {
    try { sessionStorage.removeItem(key(chainId)) } catch { /* nothing kept */ }
}

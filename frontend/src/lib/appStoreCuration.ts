/**
 * appStoreCuration — curator client for the memba_appstore_v3 review queue (B4).
 *
 * Builds the `ApproveApp` / `RejectApp` wallet messages (no coins — curation moves no funds)
 * and reads `IsCurator` for the UX gate. AUTHORITY LIVES ON-CHAIN: the realm panics on a
 * non-curator caller regardless of what this client shows; `fetchIsCurator` only decides
 * whether to render the dashboard, and fails CLOSED (false) on any read problem.
 *
 * @module lib/appStoreCuration
 */

import { queryEval } from "./dao/shared"
import type { AminoMsg } from "./grc20"
import { GNO_RPC_URL } from "./config"
import { APPSTORE_REALM_PATH, isSafeRealmPath } from "./appStore"

/** MUST stay equal to the realm's MaxReasonLen. */
export const MAX_REASON_LEN = 500

/** A bech32 account address — the only shape we'll put in a qeval expr. */
const ADDRESS_RE = /^g1[0-9a-z]{10,80}$/

/** True when `addr` is a curator on the active realm. False on ANY failure (fail closed). */
export async function fetchIsCurator(addr: string): Promise<boolean> {
    if (!ADDRESS_RE.test(addr)) return false
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `IsCurator(${JSON.stringify(addr)})`)
    if (!raw) return false
    return /\(true\s+bool\)/.test(raw)
}

function assertSafePkgPath(pkgPath: string): void {
    if (!isSafeRealmPath(pkgPath)) throw new Error("invalid app path")
}

/** ApproveApp(pkgPath) — curator-only on-chain; flips pending → live (Verified). */
export function buildApproveAppMsg(caller: string, pkgPath: string): AminoMsg {
    assertSafePkgPath(pkgPath)
    return {
        type: "vm/MsgCall",
        value: { caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "ApproveApp", args: [pkgPath] },
    }
}

/**
 * RejectApp(pkgPath, reason) — curator-only on-chain; pending → rejected, stores the reason
 * shown to the submitter and grants their free resubmit credit. An empty reason is realm-legal
 * (requiring text is the page's UX rule); an over-limit one would panic, so it throws here.
 */
export function buildRejectAppMsg(caller: string, pkgPath: string, reason: string): AminoMsg {
    assertSafePkgPath(pkgPath)
    if (reason.length > MAX_REASON_LEN) {
        throw new Error(`reason too long (max ${MAX_REASON_LEN} chars)`)
    }
    return {
        type: "vm/MsgCall",
        value: { caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "RejectApp", args: [pkgPath, reason] },
    }
}

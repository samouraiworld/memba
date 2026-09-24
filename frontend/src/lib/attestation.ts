/**
 * attestation.ts — Q-05 on-chain quest attestation (Track A, A.4).
 *
 * Fetches the connected user's backend-signed vouchers (GetAttestationVouchers)
 * and lets them broadcast each to the memba_quest_attestation_v1 realm
 * (RecordCompletion), recording their quest XP on-chain. The realm verifies the
 * ed25519 signature; the backend never broadcasts — the user does (and pays gas).
 *
 * Naturally DORMANT: the backend returns no vouchers and no realm path until
 * MEMBA_ATTESTATION_SEED is configured, so the UI renders nothing until then.
 * The panel also stays hidden unless the backend's realm is allowlisted on the
 * active network AND that realm's on-chain signer is the key the backend signs
 * with (see `isAttestationClaimable`), so no voucher is offered that the chain
 * would reject.
 */

import { create } from "@bufbuild/protobuf"
import { api } from "./api"
import {
    GetAttestationVouchersRequestSchema,
    type AttestationVoucher,
} from "../gen/memba/v1/memba_pb"
import { queryEval, sanitize } from "./dao/shared"
import { STORAGE_PRICE_UGNOT } from "./dao/v2Budget"
import { GNO_RPC_URL, isRealmValid } from "./config"

export interface AttestationState {
    vouchers: AttestationVoucher[]
    /** Realm pkgpath to broadcast to; empty when attestation is disabled. */
    realmPath: string
    signerPubkeyHex: string
}

const EMPTY: AttestationState = { vouchers: [], realmPath: "", signerPubkeyHex: "" }

/** Fetch the user's backend-signed vouchers. Empty when attestation is off. */
export async function fetchAttestationVouchers(address: string): Promise<AttestationState> {
    if (!address) return EMPTY
    try {
        const resp = await api.getAttestationVouchers(
            create(GetAttestationVouchersRequestSchema, { address }),
        )
        return {
            vouchers: resp.vouchers,
            realmPath: resp.realmPath,
            signerPubkeyHex: resp.signerPubkeyHex,
        }
    } catch {
        return EMPTY
    }
}

/** Parse a gno `string` qeval result — `("a,b" string)` → `a,b`. */
export function parseGoString(out: string): string {
    const m = out.match(/^\("(.*)"\s+string\)$/s)
    return m ? m[1] : out.trim()
}

/**
 * Quest IDs already recorded on-chain for address, read from the realm's
 * authoritative GetRecordedCompletions. Used to mark vouchers as ✓ attested vs
 * still-claimable. Returns an empty set on any read failure (degrade, not block).
 */
export async function fetchRecordedQuestIds(realmPath: string, address: string): Promise<Set<string>> {
    if (!realmPath || !address) return new Set()
    try {
        const out = await queryEval(GNO_RPC_URL, realmPath, `GetRecordedCompletions("${sanitize(address)}")`)
        if (!out) return new Set()
        const csv = parseGoString(out)
        if (!csv) return new Set()
        return new Set(csv.split(",").map(s => s.trim()).filter(Boolean))
    } catch {
        return new Set()
    }
}

/**
 * The realm's installed signer public key (lowercase hex), from GetSigner().
 * Empty when the signer is not configured or the read fails.
 */
export async function fetchRealmSignerHex(realmPath: string): Promise<string> {
    if (!realmPath) return ""
    try {
        const out = await queryEval(GNO_RPC_URL, realmPath, "GetSigner()")
        return out ? parseGoString(out).toLowerCase() : ""
    } catch {
        return ""
    }
}

/**
 * Whether the vouchers in `state` can be recorded on the ACTIVE network: the
 * backend's realm must be allowlisted here, and the realm must hold the exact
 * key the backend signs with. A mismatch means every RecordCompletion would
 * revert (signer not configured yet, a rotation in flight, or vouchers bound
 * to another chain), so the panel stays hidden instead of charging gas for it.
 */
export function isAttestationClaimable(state: AttestationState, onChainSignerHex: string): boolean {
    if (!state.realmPath || !isRealmValid(state.realmPath)) return false
    const expected = state.signerPubkeyHex.toLowerCase()
    return expected.length === 64 && expected === onChainSignerHex.toLowerCase()
}

/**
 * Gas limit and storage-deposit cap for RecordCompletion on
 * memba_quest_attestation_v1.
 *
 * Measured on an in-memory gnoland node built from the gnoland-1 runtime pin
 * (e75fef82) with the deployed realm and p/samcrew/avl sources (read from
 * chain). Each call writes three avl entries (nonce, completion, and the
 * user's XP total on their first attestation):
 *
 *   empty realm        3,147 B / 6.45M gas (first for a user), then ~4,120 B / 7.1M–9.3M
 *   16,000 entries     6,654 B / 22.8M gas (first for a user), then ~4,230 B / 24.2M–24.9M
 *   repeat voucher     ~2,080 B (nonce only) for an already-recorded quest
 *
 * Gas grows with tree depth (about 1.5M per level), so 50M covers trees far
 * past any realistic size; at gnoland-1's 1 ugnot per 1,000 gas the fee is
 * 0.06 GNOT. The deposit cap is twice an 8,000-byte estimate at 100 ugnot per
 * byte (1.6 GNOT). The chain locks only the bytes the call adds, about
 * 0.3–0.7 GNOT, and does not refund them: attestations are permanent. Without
 * `max_deposit` the chain would accept up to its 100 GNOT default.
 */
export const RECORD_COMPLETION_GAS_WANTED = 50_000_000
export const RECORD_COMPLETION_MAX_DEPOSIT_UGNOT = roundUp(8_000 * 2 * STORAGE_PRICE_UGNOT, 10_000)

function roundUp(value: number, step: number): number {
    return Math.ceil(value / step) * step
}

/**
 * Build the vm/MsgCall that records a voucher on-chain. The realm signature is
 * RecordCompletion(cur realm, addr, questId string, xp int, nonce, sigHex string)
 * — the `cur realm` crossing token is implicit, so the args are the rest. `addr`
 * MUST be the voucher's signed address (the one passed to GetAttestationVouchers).
 */
export function buildRecordCompletionMsg(
    address: string,
    realmPath: string,
    v: AttestationVoucher,
): { type: string; value: Record<string, unknown> } {
    return {
        type: "vm/MsgCall",
        value: {
            caller: address,
            send: "",
            pkg_path: realmPath,
            func: "RecordCompletion",
            args: [address, v.questId, String(v.xp), v.nonce, v.sigHex],
            max_deposit: `${RECORD_COMPLETION_MAX_DEPOSIT_UGNOT}ugnot`,
        },
    }
}

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
 */

import { create } from "@bufbuild/protobuf"
import { api } from "./api"
import {
    GetAttestationVouchersRequestSchema,
    type AttestationVoucher,
} from "../gen/memba/v1/memba_pb"
import { queryEval, sanitize } from "./dao/shared"
import { GNO_RPC_URL } from "./config"

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
        },
    }
}

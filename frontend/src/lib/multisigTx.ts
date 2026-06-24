// Canonical multisig sign-doc builders.
//
// These produce the EXACT gno-canonical shape that Adena's SignMultisigTransaction
// signs and the backend A3 verifier (CanonicalSignBytes / VerifyMultisigMemberSignature)
// reconstructs. The frontend must STORE this shape (not the cosmos {amount,gas} /
// {type,value}-wrapped shape) so the stored doc == the signed doc; otherwise A3
// verification fails and enforcing MEMBA_ENFORCE_MULTISIG_SIG_VERIFY bricks signing.
//
// Authority: backend/internal/auth/testdata/signbytes/*.json (golden vs `gnokey sign`)
// and the prod-proven frontend/src/lib/loginChallenge.ts:buildLoginChallengeDoc (A2).

import type { AminoMsg } from "./grc20"

/**
 * Convert an Amino `{type,value}` msg to the gno-canonical `@type`-inlined form.
 *
 * - `bank/MsgSend` → `{"@type":"/bank.MsgSend",from_address,to_address,amount:"<n>ugnot"}`
 *   (amount is a coin STRING, never a coin array — see send_basic.json).
 * - `vm/MsgCall` → `{"@type":"/vm.m_call",args:<arr|null>,caller,send,max_deposit:"",pkg_path,func}`
 *   `args` is `null` when empty (NOT `[]`, NOT omitted) to match Adena's proto-roundtrip
 *   form and the backend reconstruction (loginChallenge.ts:99-101).
 */
export function toCanonicalMsg(m: AminoMsg): Record<string, unknown> {
    if (m.type === "bank/MsgSend") {
        const v = m.value as {
            from_address: string
            to_address: string
            amount: Array<{ denom: string; amount: string }> | string
        }
        const amount = Array.isArray(v.amount)
            ? v.amount[0]
                ? `${v.amount[0].amount}${v.amount[0].denom}`
                : ""
            : (v.amount ?? "")
        return { "@type": "/bank.MsgSend", from_address: v.from_address, to_address: v.to_address, amount }
    }
    if (m.type === "vm/MsgCall") {
        const v = m.value as {
            caller: string
            send?: string
            max_deposit?: string
            pkg_path: string
            func: string
            args?: string[]
        }
        const args = v.args && v.args.length > 0 ? v.args : null
        return {
            "@type": "/vm.m_call",
            args,
            caller: v.caller,
            send: v.send ?? "",
            max_deposit: v.max_deposit ?? "",
            pkg_path: v.pkg_path,
            func: v.func,
        }
    }
    throw new Error(`toCanonicalMsg: unsupported msg type ${m.type}`)
}

/** Build the canonical fee JSON the backend stores + reconstructs: `{gas_wanted, gas_fee}`. */
export function buildCanonicalFeeJson(gasWanted: string, gasFeeUgnot: string): string {
    return JSON.stringify({ gas_wanted: gasWanted, gas_fee: gasFeeUgnot })
}

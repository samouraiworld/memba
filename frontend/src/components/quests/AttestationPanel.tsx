/**
 * AttestationPanel — Q-05 A.4 on-chain quest attestation.
 *
 * Shows the connected user's backend-signed vouchers and lets them broadcast
 * each to the memba_quest_attestation_v1 realm, recording their quest XP
 * on-chain. Renders nothing when there are no vouchers (the natural dormant
 * state until the backend's MEMBA_ATTESTATION_SEED is configured), and nothing
 * when the vouchers cannot be recorded on the active network (realm not
 * allowlisted here, or its on-chain signer is not the backend's key).
 */

import { useState, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { getQuestById } from "../../lib/gnobuilders"
import {
    fetchAttestationVouchers,
    fetchRecordedQuestIds,
    fetchRealmSignerHex,
    isAttestationClaimable,
    buildRecordCompletionMsg,
    RECORD_COMPLETION_GAS_WANTED,
    RECORD_COMPLETION_MAX_DEPOSIT_UGNOT,
    type AttestationState,
} from "../../lib/attestation"
import { doContractBroadcast } from "../../lib/grc20"
import { isUserCancellation, friendlyError } from "../../lib/errorMessages"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import "./attestationpanel.css"

export function AttestationPanel({ address }: { address: string }) {
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Vouchers + the realm's signer and authoritative record, in one query per
    // wallet. Vouchers the active chain would reject are dropped here.
    const attQuery = useQuery({
        queryKey: ["quests", "attestation", address],
        enabled: !!address,
        queryFn: async () => {
            const s = await fetchAttestationVouchers(address)
            if (!s.realmPath || s.vouchers.length === 0) return { state: s, recorded: new Set<string>() }
            const [signer, rec] = await Promise.all([
                fetchRealmSignerHex(s.realmPath),
                fetchRecordedQuestIds(s.realmPath, address),
            ])
            return { state: isAttestationClaimable(s, signer) ? s : null, recorded: rec }
        },
    })
    const state: AttestationState | null = attQuery.data?.state ?? null
    const recorded = attQuery.data?.recorded ?? new Set<string>()
    // refetch is referentially stable — the attest callback deps on it.
    const { refetch: refetchAttestation } = attQuery

    const attest = useCallback(async (questId: string) => {
        if (!state || !state.realmPath) return
        const voucher = state.vouchers.find(v => v.questId === questId)
        if (!voucher) return
        setBusy(questId)
        setError(null)
        try {
            // No automatic retry: if a landed call's response is lost, a retry
            // would prompt the wallet again only to fail on the used nonce.
            await doContractBroadcast(
                [buildRecordCompletionMsg(address, state.realmPath, voucher)],
                `Attest quest "${questId}" on-chain`,
                { gasWanted: RECORD_COMPLETION_GAS_WANTED, retry: false },
            )
        } catch (err) {
            // Silently dismiss a user-rejected/cancelled tx; surface real failures
            // via the shared formatter (matches the other broadcast panels).
            setError(isUserCancellation(err) ? null : friendlyError(err))
        } finally {
            // Confirm against the realm's authoritative record either way, so a
            // call that landed despite an error still shows as recorded.
            await refetchAttestation()
            setBusy(null)
        }
    }, [state, address, refetchAttestation])

    // Dormant: nothing to attest (attestation disabled, or no completions yet).
    if (!state || state.vouchers.length === 0) return null

    const pending = state.vouchers.filter(v => !recorded.has(v.questId))
    const attestedCount = state.vouchers.length - pending.length

    return (
        <section className="k-attest" aria-label="On-chain quest attestation">
            <div className="k-attest-head">
                <h3>On-chain attestation</h3>
                <span className="k-attest-sub">
                    {attestedCount}/{state.vouchers.length} recorded on-chain
                </span>
            </div>
            <p className="k-attest-note">
                Record your quest XP on-chain — a verifiable, self-custodied proof, not just our database.
                You broadcast it yourself: a small gas fee, plus a storage deposit of up to{" "}
                {formatUgnotExact(RECORD_COMPLETION_MAX_DEPOSIT_UGNOT)} per quest that stays locked with the record.
            </p>
            {error && <div className="k-attest-error" role="alert">{error}</div>}
            <ul className="k-attest-list" role="list">
                {state.vouchers.map(v => {
                    const done = recorded.has(v.questId)
                    const q = getQuestById(v.questId)
                    return (
                        <li key={v.questId} className="k-attest-item" role="listitem">
                            <span className="k-attest-quest">
                                {q?.icon} {q?.title ?? v.questId}
                                <span className="k-attest-xp">+{v.xp} XP</span>
                            </span>
                            {done ? (
                                <span className="k-attest-done">✓ on-chain</span>
                            ) : (
                                <button
                                    type="button"
                                    className="k-attest-btn"
                                    disabled={busy !== null}
                                    onClick={() => attest(v.questId)}
                                >
                                    {busy === v.questId ? "Attesting…" : "Attest on-chain"}
                                </button>
                            )}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

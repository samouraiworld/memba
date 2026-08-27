/**
 * AttestationPanel — Q-05 A.4 on-chain quest attestation.
 *
 * Shows the connected user's backend-signed vouchers and lets them broadcast
 * each to the memba_quest_attestation_v1 realm, recording their quest XP
 * on-chain. Renders nothing when there are no vouchers (the natural dormant
 * state until the backend's MEMBA_ATTESTATION_SEED is configured).
 */

import { useState, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { getQuestById } from "../../lib/gnobuilders"
import {
    fetchAttestationVouchers,
    fetchRecordedQuestIds,
    buildRecordCompletionMsg,
    type AttestationState,
} from "../../lib/attestation"
import { doContractBroadcast } from "../../lib/grc20"
import { isUserCancellation, friendlyError } from "../../lib/errorMessages"
import "./attestationpanel.css"

export function AttestationPanel({ address }: { address: string }) {
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Vouchers + the realm's authoritative record, in one query per wallet.
    const attQuery = useQuery({
        queryKey: ["quests", "attestation", address],
        enabled: !!address,
        queryFn: async () => {
            const s = await fetchAttestationVouchers(address)
            const rec = s.realmPath ? await fetchRecordedQuestIds(s.realmPath, address) : new Set<string>()
            return { state: s, recorded: rec }
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
            await doContractBroadcast(
                [buildRecordCompletionMsg(address, state.realmPath, voucher)],
                `Attest quest "${questId}" on-chain`,
            )
            // Confirm against the realm's authoritative record (degrade gracefully).
            await refetchAttestation()
        } catch (err) {
            // Silently dismiss a user-rejected/cancelled tx; surface real failures
            // via the shared formatter (matches the other broadcast panels).
            setError(isUserCancellation(err) ? null : friendlyError(err))
        } finally {
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
                You broadcast it yourself (small gas fee).
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

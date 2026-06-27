/**
 * AttestationPanel — Q-05 A.4 on-chain quest attestation.
 *
 * Shows the connected user's backend-signed vouchers and lets them broadcast
 * each to the memba_quest_attestation_v1 realm, recording their quest XP
 * on-chain. Renders nothing when there are no vouchers (the natural dormant
 * state until the backend's MEMBA_ATTESTATION_SEED is configured).
 */

import { useState, useEffect, useCallback } from "react"
import { getQuestById } from "../../lib/gnobuilders"
import {
    fetchAttestationVouchers,
    fetchRecordedQuestIds,
    buildRecordCompletionMsg,
    type AttestationState,
} from "../../lib/attestation"
import { doContractBroadcast } from "../../lib/grc20"
import "./attestationpanel.css"

export function AttestationPanel({ address }: { address: string }) {
    const [state, setState] = useState<AttestationState | null>(null)
    const [recorded, setRecorded] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!address) return
        const s = await fetchAttestationVouchers(address)
        setState(s)
        if (s.realmPath) setRecorded(await fetchRecordedQuestIds(s.realmPath, address))
    }, [address])

    useEffect(() => { void load() }, [load])

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
            setRecorded(await fetchRecordedQuestIds(state.realmPath, address))
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Attestation failed"
            setError(msg.includes("cancelled") ? null : msg)
        } finally {
            setBusy(null)
        }
    }, [state, address])

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

/**
 * CandidaturePage — Memba DAO membership application form.
 *
 * Gated by quest XP: users must reach CANDIDATURE_XP_THRESHOLD (100 XP)
 * before they can submit. Displays current quest progress when below threshold.
 *
 * On submit, builds a MsgCall to the candidature realm and broadcasts via Adena.
 */

import { useState, useEffect, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { ErrorToast } from "../components/ui/ErrorToast"
import { QuestProgress } from "../components/ui/QuestProgress"
import {
    canApplyForMembership,
    loadQuestProgress,
    CANDIDATURE_XP_THRESHOLD,
    trackPageVisit,
} from "../lib/quests"
import {
    validateCandidature,
    parseSkills,
    buildSubmitCandidatureMsg,
    parseCandidatureList,
    getCandidatureSendAmount,
    MAX_NAME_LENGTH,
    MAX_PHILOSOPHY_LENGTH,
    MAX_SKILLS_LENGTH,
    type Candidature,
} from "../lib/candidatureTemplate"
import { MEMBA_DAO, GNO_RPC_URL } from "../lib/config"
import { doContractBroadcast } from "../lib/grc20"
import { queryRender } from "../lib/dao/shared"
import type { LayoutContext } from "../types/layout"
import "./candidature.css"

export default function CandidaturePage() {
    const navigate = useNetworkNav()
    const { adena, auth } = useOutletContext<LayoutContext>()

    const [eligible, setEligible] = useState(false)
    const [questState, setQuestState] = useState(() => loadQuestProgress())
    const [name, setName] = useState("")
    const [philosophy, setPhilosophy] = useState("")
    const [skills, setSkills] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [candidatures, setCandidatures] = useState<Candidature[]>([])
    const [loadingList, setLoadingList] = useState(true)

    useEffect(() => {
        document.title = "Candidature — Memba"
        trackPageVisit("candidature")
        setEligible(canApplyForMembership())
        setQuestState(loadQuestProgress())
    }, [])

    // Load existing candidatures from on-chain
    const loadCandidatures = useCallback(async () => {
        setLoadingList(true)
        try {
            const raw = await queryRender(GNO_RPC_URL, MEMBA_DAO.candidaturePath, "")
            if (raw) {
                setCandidatures(parseCandidatureList(raw))
            }
        } catch {
            // Realm may not be deployed yet — graceful degradation
        } finally {
            setLoadingList(false)
        }
    }, [])

    useEffect(() => { loadCandidatures() }, [loadCandidatures])

    // Check if this user already submitted
    const existingCandidature = candidatures.find(
        c => c.applicant === (auth.address || adena.address)
    )
    const pastRejections = candidatures.filter(
        c => c.applicant === (auth.address || adena.address) && c.status === "rejected"
    ).length

    const handleSubmit = async () => {
        if (!adena.connected || !auth.isAuthenticated) {
            setError("Connect your wallet first")
            return
        }

        const validationError = validateCandidature(name, philosophy, skills)
        if (validationError) {
            setError(validationError)
            return
        }

        setSubmitting(true)
        setError(null)

        try {
            const msg = buildSubmitCandidatureMsg(
                adena.address,
                name.trim(),
                philosophy.trim(),
                skills.trim(),
                MEMBA_DAO.candidaturePath,
                pastRejections,
            )
            await doContractBroadcast([msg], "Memba DAO Candidature")
            setSubmitted(true)
            loadCandidatures()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Candidature submission failed")
        } finally {
            setSubmitting(false)
        }
    }

    const sendCost = getCandidatureSendAmount(pastRejections)

    return (
        <div className="candidature-page animate-fade-in">
            <h1 className="candidature-title">Memba DAO Candidature</h1>
            <p className="candidature-subtitle">
                Apply to become a member of Memba DAO. Earn {CANDIDATURE_XP_THRESHOLD} XP from quests to unlock your application.
            </p>

            {/* ── XP Gate ──────────────────────────────────── */}
            {!eligible && (
                <div className="k-card candidature-gate">
                    <div className="candidature-gate__header">
                        <span className="candidature-gate__icon">🔒</span>
                        <div>
                            <h3 className="candidature-gate__title">XP Required</h3>
                            <p className="candidature-gate__desc">
                                You need {CANDIDATURE_XP_THRESHOLD} XP to apply. You currently have {questState.totalXP} XP.
                                Complete more quests to unlock candidature.
                            </p>
                        </div>
                    </div>
                    <QuestProgress />
                </div>
            )}

            {/* ── Already submitted ────────────────────────── */}
            {existingCandidature && (
                <div className={`k-card candidature-status candidature-status--${existingCandidature.status}`}>
                    <h3 className="candidature-status__title">
                        {existingCandidature.status === "pending" && "⏳ Candidature Pending"}
                        {existingCandidature.status === "approved" && "✅ Candidature Approved"}
                        {existingCandidature.status === "rejected" && "❌ Candidature Rejected"}
                    </h3>
                    <p className="candidature-status__meta">
                        Name: {existingCandidature.name} | Skills: {existingCandidature.skills}
                    </p>
                    {existingCandidature.status === "pending" && (
                        <p className="candidature-status__approvals">
                            Approvals: {existingCandidature.approvedBy.length}/2
                        </p>
                    )}
                </div>
            )}

            {/* ── Submission Form ──────────────────────────── */}
            {eligible && !existingCandidature && !submitted && (
                <div className="k-card candidature-form">
                    <h3 className="candidature-form__title">Submit Your Application</h3>

                    {sendCost > 0n && (
                        <div className="candidature-form__cost">
                            Re-application fee: {Number(sendCost) / 1_000_000} GNOT
                        </div>
                    )}

                    <div className="candidature-form__field">
                        <label htmlFor="cand-name">Name</label>
                        <input
                            id="cand-name"
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            maxLength={MAX_NAME_LENGTH}
                            placeholder="Your name or pseudonym"
                            disabled={submitting}
                        />
                        <span className="candidature-form__counter">{name.length}/{MAX_NAME_LENGTH}</span>
                    </div>

                    <div className="candidature-form__field">
                        <label htmlFor="cand-philosophy">Why Memba?</label>
                        <textarea
                            id="cand-philosophy"
                            value={philosophy}
                            onChange={e => setPhilosophy(e.target.value)}
                            maxLength={MAX_PHILOSOPHY_LENGTH}
                            placeholder="Tell us why you want to join Memba DAO and what you'll contribute..."
                            rows={4}
                            disabled={submitting}
                        />
                        <span className="candidature-form__counter">{philosophy.length}/{MAX_PHILOSOPHY_LENGTH}</span>
                    </div>

                    <div className="candidature-form__field">
                        <label htmlFor="cand-skills">Skills</label>
                        <input
                            id="cand-skills"
                            type="text"
                            value={skills}
                            onChange={e => setSkills(e.target.value)}
                            maxLength={MAX_SKILLS_LENGTH}
                            placeholder="rust, go, react, design, community..."
                            disabled={submitting}
                        />
                        <span className="candidature-form__counter">{skills.length}/{MAX_SKILLS_LENGTH}</span>
                    </div>

                    {skills && (
                        <div className="candidature-form__preview">
                            {parseSkills(skills).map(s => (
                                <span key={s} className="candidature-skill-tag">{s}</span>
                            ))}
                        </div>
                    )}

                    <button
                        className={`candidature-form__submit${submitting ? " submitting" : ""}`}
                        onClick={handleSubmit}
                        disabled={submitting || !adena.connected}
                    >
                        {submitting ? "Submitting..." : "Submit Candidature"}
                    </button>
                </div>
            )}

            {/* ── Success ──────────────────────────────────── */}
            {submitted && (
                <div className="k-card candidature-success">
                    <span className="candidature-success__icon">🎉</span>
                    <h3 className="candidature-success__title">Candidature Submitted!</h3>
                    <p className="candidature-success__desc">
                        Your application is now pending review. Two existing members must approve it.
                    </p>
                    <button
                        className="candidature-success__btn"
                        onClick={() => navigate("/dashboard")}
                    >
                        Back to Dashboard
                    </button>
                </div>
            )}

            {/* ── Existing Candidatures ────────────────────── */}
            {candidatures.length > 0 && (
                <div className="k-card candidature-list">
                    <h3 className="candidature-list__title">
                        All Candidatures ({candidatures.length})
                    </h3>
                    <div className="candidature-list__items">
                        {candidatures.map(c => (
                            <div key={c.applicant} className={`candidature-list__item candidature-list__item--${c.status}`}>
                                <div className="candidature-list__item-header">
                                    <span className="candidature-list__item-name">{c.name}</span>
                                    <span className={`candidature-list__item-badge candidature-list__item-badge--${c.status}`}>
                                        {c.status}
                                    </span>
                                </div>
                                <span className="candidature-list__item-addr">
                                    {c.applicant.slice(0, 10)}...{c.applicant.slice(-4)}
                                </span>
                                {c.skills && (
                                    <div className="candidature-list__item-skills">
                                        {parseSkills(c.skills).map(s => (
                                            <span key={s} className="candidature-skill-tag candidature-skill-tag--sm">{s}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {loadingList && candidatures.length === 0 && (
                <div className="candidature-loading">Loading candidatures...</div>
            )}

            {!loadingList && candidatures.length === 0 && (
                <div className="candidature-empty">
                    No candidatures yet. Be the first to apply!
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

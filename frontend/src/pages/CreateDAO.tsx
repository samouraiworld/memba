import { useState, useCallback, useEffect, useRef } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { NotePencil } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { friendlyError } from "../lib/errorMessages"
import { DeploymentPipeline, type DeployStep, type DeploymentResult } from "../components/ui/DeploymentPipeline"
import { WizardStepPreset } from "../components/dao/WizardStepPreset"
import { WizardStepMembers } from "../components/dao/WizardStepMembers"
import { WizardStepConfig } from "../components/dao/WizardStepConfig"
import { WizardStepReview } from "../components/dao/WizardStepReview"
import { WizardStepExtensions } from "../components/dao/WizardStepExtensions"
import type { MemberInput, Step } from "../components/dao/wizardShared"
import { generateDAOCode, buildDeployDAOMsg, daoStepError, isValidGnoAddress, DAO_PRESETS, type DAOCreationConfig, type DAOPreset, type DAOStepData } from "../lib/daoTemplate"
import { generateChannelCode, defaultChannelConfig, isValidChannelName } from "../lib/channelTemplate"
import { buildDeployMsg } from "../lib/templates/prologue"
import { addSavedDAO, encodeSlug } from "../lib/daoSlug"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"
import "./createdao.css"

// ── Draft Persistence ─────────────────────────────────────

const DRAFT_KEY = "memba_dao_draft"
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface DraftData {
    name: string
    description: string
    realmPath: string
    members: MemberInput[]
    threshold: number
    quorum: number
    enableChannels?: boolean
    channelNames?: string[]
    /** Legacy draft fields (pre-W1.5 board naming) — read-only fallback. */
    enableBoard?: boolean
    boardChannels?: string[]
    availableRoles: string[]; proposalCategories: string[]
    selectedPreset: string | null; step: Step
    savedAt: number
}

function isDraft(value: unknown): value is DraftData {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const d = value as Record<string, unknown>
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string")
    if (![d.name, d.description, d.realmPath].every(v => typeof v === "string")) return false
    if (!strings(d.availableRoles) || !strings(d.proposalCategories)) return false
    if (!Array.isArray(d.members) || !d.members.every(m => m && typeof m === "object" &&
        typeof m.address === "string" && Number.isSafeInteger(m.power) && strings(m.roles))) return false
    if (!Number.isSafeInteger(d.threshold) || !Number.isSafeInteger(d.quorum)) return false
    if (d.selectedPreset !== null && (typeof d.selectedPreset !== "string" || !DAO_PRESETS.some(p => p.id === d.selectedPreset))) return false
    if (typeof d.step !== "number" || !Number.isInteger(d.step) || d.step < 1 || d.step > 5) return false
    if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt) || d.savedAt > Date.now() || Date.now() - d.savedAt > DRAFT_TTL_MS) return false
    if ([d.enableChannels, d.enableBoard].some(v => v !== undefined && typeof v !== "boolean")) return false
    if ([d.channelNames, d.boardChannels].some(v => v !== undefined && !strings(v))) return false
    return true
}

function loadDraft(): DraftData | null {
    try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (!raw) return null
        const draft: unknown = JSON.parse(raw)
        if (!isDraft(draft)) {
            clearDraft()
            return null
        }
        return draft
    } catch {
        clearDraft()
        return null
    }
}

function saveDraft(data: Omit<DraftData, "savedAt">) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
    } catch { /* quota exceeded — silently fail */ }
}

function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* Storage access must not turn a confirmed transaction into a failure. */ }
}

/** Voting period, delay and window of the chosen preset (Basic when none). */
function presetWindows(preset: DAOPreset | undefined): Pick<DAOCreationConfig, "votingPeriodSeconds" | "executionDelaySeconds" | "executionWindowSeconds"> {
    const p = preset ?? DAO_PRESETS[0]
    return { votingPeriodSeconds: p.votingPeriodSeconds, executionDelaySeconds: p.executionDelaySeconds, executionWindowSeconds: p.executionWindowSeconds }
}

// ── Main Component (Orchestrator) ─────────────────────────

export function CreateDAO() {
    const navigate = useNetworkNav()
    const { adena } = useOutletContext<LayoutContext>()

    // Wizard state — shared across steps
    const [step, setStep] = useState<Step>(1)
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [realmPath, setRealmPath] = useState("")
    const [members, setMembers] = useState<MemberInput[]>([{ address: "", power: 1, roles: ["admin"] }])
    const [threshold, setThreshold] = useState(51)
    const [quorum, setQuorum] = useState(0)
    const [availableRoles, setAvailableRoles] = useState<string[]>(["admin", "member"])
    const [proposalCategories, setProposalCategories] = useState<string[]>(["governance"])
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
    const [enableChannels, setEnableChannels] = useState(false)
    const [channelNames, setChannelNames] = useState<string[]>(["general"])
    const [deploying, setDeploying] = useState(false)
    const [deployStep, setDeployStep] = useState<DeployStep>("idle")
    const [deployResult, setDeployResult] = useState<DeploymentResult | undefined>()
    const [error, setError] = useState<string | null>(null)
    // Step-validation messages are shown as a gentle inline notice — NOT routed
    // through the system ErrorToast, which dramatizes "name required" into
    // "Something went wrong / reload the page".
    const [validationError, setValidationError] = useState<string | null>(null)
    const [generatedCode, setGeneratedCode] = useState("")
    // Lazy initializer, not a mount effect: whether a draft exists is known
    // synchronously from localStorage at first render.
    const [showDraftBanner, setShowDraftBanner] = useState(() => !!loadDraft())
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const resumeDraft = () => {
        const draft = loadDraft()
        if (!draft) return
        setName(draft.name)
        setDescription(draft.description)
        setRealmPath(draft.realmPath)
        setMembers(draft.members)
        setThreshold(draft.threshold)
        setQuorum(draft.quorum)
        setAvailableRoles(draft.availableRoles)
        setProposalCategories(draft.proposalCategories)
        const draftEnable = draft.enableChannels ?? draft.enableBoard
        if (draftEnable !== undefined) setEnableChannels(draftEnable)
        const draftNames = draft.channelNames ?? draft.boardChannels
        if (draftNames) setChannelNames(draftNames)
        setSelectedPreset(draft.selectedPreset)
        let resumeStep = draft.step
        if (resumeStep === 5) {
            try {
                for (const step of [1, 2, 3]) {
                    const error = daoStepError(step, draft)
                    if (error) throw new Error(error)
                }
                const preset = DAO_PRESETS.find(p => p.id === draft.selectedPreset)
                setGeneratedCode(generateDAOCode({
                    name: draft.name, description: draft.description, realmPath: draft.realmPath,
                    members: draft.members.filter(m => m.address !== ""), roles: draft.availableRoles,
                    threshold: draft.threshold, quorum: draft.quorum, proposalCategories: draft.proposalCategories,
                    ...presetWindows(preset),
                }))
            } catch {
                resumeStep = 1
                setValidationError("This draft needs review. Check its settings before deploying.")
            }
        }
        setStep(resumeStep)
        setShowDraftBanner(false)
    }

    const discardDraft = () => {
        clearDraft()
        setShowDraftBanner(false)
    }

    // ── Auto-save draft (debounced 500ms) ─────────────────

    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        if (showDraftBanner || deploying || deployResult) return
        saveTimerRef.current = setTimeout(() => {
            if (name || realmPath || members.some((m) => m.address)) {
                saveDraft({
                    name, description, realmPath, members,
                    threshold, quorum, availableRoles, proposalCategories,
                    selectedPreset, step, enableChannels, channelNames,
                })
            }
        }, 500)
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    }, [name, description, realmPath, members, threshold, quorum, availableRoles, proposalCategories, selectedPreset, step, enableChannels, channelNames, showDraftBanner, deploying, deployResult])

    // ── Preset ────────────────────────────────────────────

    const applyPreset = useCallback((preset: DAOPreset) => {
        setSelectedPreset(preset.id)
        setAvailableRoles(preset.roles)
        setThreshold(preset.threshold)
        setQuorum(preset.quorum)
        setProposalCategories(preset.categories)
        setMembers((prev) => prev.map((m, i) => i === 0 ? { ...m, roles: ["admin"] } : { ...m, roles: ["member"] }))
    }, [])

    // ── Navigation ────────────────────────────────────────

    const autoFillPath = useCallback(() => {
        if (!adena.address) return
        setRealmPath(`gno.land/r/${adena.address}/${name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20) || "mydao"}`)
    }, [adena.address, name])

    const buildStepData = (): DAOStepData => ({ name, realmPath, members, threshold, quorum })

    const goToStep = (s: Step) => {
        setError(null)
        setValidationError(null)
        // Validate before advancing — single source of truth (nextStep delegates
        // here). Check each step between the current one and the target; on the
        // first invalid step, surface a gentle inline notice and stay on it.
        if (s > step) {
            const data = buildStepData()
            for (let k = step; k < s; k++) {
                const err = daoStepError(k, data)
                if (err) { setValidationError(err); setStep(k as Step); return }
            }
        }
        if (s === 5) {
            const preset = DAO_PRESETS.find(p => p.id === selectedPreset)
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold, quorum, proposalCategories,
                roles: availableRoles,
                members: members.filter((m) => m.address !== ""),
                ...presetWindows(preset),
            }
            // W1.1: codegen is fail-closed and throws on invalid input. Steps
            // should have caught everything, but never crash the wizard —
            // surface the message through the same inline notice.
            try {
                setGeneratedCode(generateDAOCode(config))
            } catch (err) {
                setValidationError(err instanceof Error ? err.message : String(err))
                return
            }
        }
        setStep(s)
    }

    // ── Validation ────────────────────────────────────────

    // Validation now lives in goToStep's forward-nav guard (single source of
    // truth), so advancing is just a forward navigation.
    const nextStep = () => goToStep((step + 1) as Step)

    // ── Category toggle ───────────────────────────────────

    const toggleCategory = (cat: string) => {
        if (proposalCategories.includes(cat)) {
            if (proposalCategories.length <= 1) return
            setProposalCategories(proposalCategories.filter((c) => c !== cat))
        } else {
            setProposalCategories([...proposalCategories, cat])
        }
    }

    // ── Deploy ────────────────────────────────────────────

    const deployDAO = async () => {
        if (deploying || deployResult) return
        if (!adena.address) { setError("Connect your wallet first"); return }
        setDeploying(true)
        setDeployStep("preparing")
        setError(null)
        try {
            for (const step of [1, 2, 3]) {
                const error = daoStepError(step, buildStepData())
                if (error) throw new Error(error)
            }
            const preset = DAO_PRESETS.find(p => p.id === selectedPreset)
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold, quorum, proposalCategories,
                roles: availableRoles,
                members: members.filter((m) => m.address !== ""),
                ...presetWindows(preset),
            }
            const code = generateDAOCode(config)
            const msg = buildDeployDAOMsg(adena.address, realmPath, code, "10000000ugnot")

            // Validate both packages before the first wallet request. A local
            // extension error must not leave an unexpectedly partial deployment.
            let channelMsg: ReturnType<typeof buildDeployMsg> | undefined
            if (enableChannels) {
                if (channelNames.length < 1 || channelNames.length > 5 ||
                    channelNames.some(n => !isValidChannelName(n)) || new Set(channelNames).size !== channelNames.length) {
                    throw new Error("Choose one to five valid, distinct channel names before deploying")
                }
                const channelConfig = defaultChannelConfig(realmPath, name)
                channelConfig.channels = channelNames.map(n => ({ name: n, type: "text", acl: { readRoles: [], writeRoles: [] } }))
                channelConfig.members = config.members.map(m => ({ address: m.address, roles: m.roles }))
                channelMsg = buildDeployMsg(adena.address, channelConfig.channelRealmPath, generateChannelCode(channelConfig), "10000000ugnot")
            }

            setDeployStep("signing")

            // TODO: Re-add 2 GNOT dev fee — test11 transfers now allowed (2026-04-09),
            // but needs on-chain testing before enabling. Add send amount to DoContract.
            // W2.1: guarded broadcaster — RPC-trust, wrong-chain and A6
            // confirmation now cover realm deploys too. Throws on failure.
            const res = await doContractBroadcast(
                [{ type: "/vm.m_addpkg", value: msg.value }],
                `Deploy DAO: ${name}`,
                { gas: "deploy" },
            )

            setDeployStep("broadcasting")

            // Preserve the confirmed primary result even if a later wallet
            // request or local-storage write fails. Never offer to redeploy it.
            const result: DeploymentResult = {
                realmPath, entityPath: `/dao/${encodeSlug(realmPath)}`,
                entityLabel: "DAO", entityName: name, txHash: res.hash,
            }
            const warnings: string[] = []
            setDeployResult(result)
            try { addSavedDAO(realmPath, name) } catch {
                warnings.push("Your DAO was created, but could not be saved in this browser. Keep its realm path.")
            }
            clearDraft()

            if (channelMsg) {
                setDeployStep("signing")
                try {
                    await doContractBroadcast(
                        [{ type: "/vm.m_addpkg", value: channelMsg.value }],
                        `Deploy Channels for ${name}`, { gas: "deploy" },
                    )
                } catch (channelErr) {
                    warnings.push(`Channels deployment was not confirmed: ${friendlyError(channelErr)}. Your DAO is already created. Check the Channels realm before attempting a separate deployment.`)
                }
            }

            setDeployResult({ ...result, warnings })
            setDeployStep("complete")
        } catch (err) {
            setError(friendlyError(err))
            setDeployStep("error")
        } finally {
            setDeploying(false)
        }
    }

    // ── Derived ───────────────────────────────────────────

    const validMembers = members.filter((m) => isValidGnoAddress(m.address))
    const totalPower = validMembers.reduce((sum, m) => sum + m.power, 0)
    const adminCount = validMembers.filter((m) => m.roles.includes("admin")).length

    // ── Render ────────────────────────────────────────────

    return (
        <div className="animate-fade-in cdao-page">
            {/* Nav */}
            <button
                id="create-dao-back-btn"
                aria-label="Back to DAO list"
                onClick={() => navigate("/dao")}
                className="cdao-back-btn"
            >
                ← Back to DAOs
            </button>

            {/* Draft resume banner */}
            {showDraftBanner && (
                <div className="k-card cdao-draft-banner">
                    <div className="cdao-draft-banner__info">
                        <span className="cdao-draft-banner__icon"><NotePencil size={16} /></span>
                        <span className="cdao-draft-banner__text">
                            You have an unsaved draft
                        </span>
                    </div>
                    <div className="cdao-draft-banner__actions">
                        <button className="k-btn-primary" onClick={resumeDraft}>
                            Resume
                        </button>
                        <button className="k-btn-secondary" onClick={discardDraft}>
                            Discard
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div>
                <h2 className="cdao-title">
                    🏗️ Create a DAO
                </h2>
                <p className="cdao-subtitle">
                    Deploy a new governance realm on gno.land
                </p>
            </div>

            {/* Step indicator */}
            <div className="cdao-steps">
                {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className="cdao-step-group">
                        <div
                            className={`cdao-step-circle ${s === step ? "cdao-step-circle--active" : s < step ? "cdao-step-circle--done" : "cdao-step-circle--future"}`}
                            onClick={() => s < step && goToStep(s as Step)}
                        >
                            {s < step ? "✓" : s}
                        </div>
                        {s < 5 && <div className={`cdao-step-connector ${s < step ? "cdao-step-connector--done" : "cdao-step-connector--future"}`} />}
                    </div>
                ))}
                <span className="cdao-step-label">
                    {step === 1 && "Name, Path & Preset"}
                    {step === 2 && "Members & Roles"}
                    {step === 3 && "Governance Settings"}
                    {step === 4 && "Extensions"}
                    {step === 5 && "Review & Deploy"}
                </span>
            </div>

            {/* Step 1: Name, Path & Preset */}
            {step === 1 && (
                <WizardStepPreset
                    name={name} description={description} realmPath={realmPath}
                    selectedPreset={selectedPreset} walletAddress={adena.address}
                    onNameChange={setName} onDescriptionChange={setDescription}
                    onRealmPathChange={setRealmPath} onApplyPreset={applyPreset}
                    onAutoFill={autoFillPath} onNext={nextStep}
                />
            )}

            {/* Step 2: Members & Roles */}
            {step === 2 && (
                <WizardStepMembers
                    members={members} availableRoles={availableRoles}
                    walletAddress={adena.address} validMembers={validMembers}
                    adminCount={adminCount} totalPower={totalPower}
                    onMembersChange={setMembers} onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 3: Governance Settings */}
            {step === 3 && (
                <WizardStepConfig
                    threshold={threshold} quorum={quorum}
                    proposalCategories={proposalCategories} validMembers={validMembers}
                    totalPower={totalPower} onThresholdChange={setThreshold}
                    onQuorumChange={setQuorum} onToggleCategory={toggleCategory}
                    onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 4: Extensions */}
            {step === 4 && (
                <WizardStepExtensions
                    enableChannels={enableChannels} channelNames={channelNames}
                    onEnableChannelsChange={setEnableChannels} onChannelNamesChange={setChannelNames}
                    onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 5: Review & Deploy */}
            {step === 5 && (
                <WizardStepReview
                    name={name} description={description} realmPath={realmPath}
                    selectedPreset={selectedPreset} threshold={threshold} quorum={quorum}
                    availableRoles={availableRoles} proposalCategories={proposalCategories}
                    validMembers={validMembers} totalPower={totalPower}
                    generatedCode={generatedCode} deploying={deploying}
                    walletAddress={adena.address} onGoToStep={goToStep} onDeploy={deployDAO}
                />
            )}

            {/* Step validation notice — gentle inline, not the system ErrorToast */}
            {validationError && (
                <div className="k-card" role="alert" style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 14px", fontSize: "var(--pro-small, 13px)",
                    borderColor: "var(--color-k-amber-border)",
                    background: "var(--color-k-amber-subtle)",
                    color: "var(--color-k-warning)",
                }}>
                    <span aria-hidden="true">⚠</span> {validationError}
                </div>
            )}

            {/* Deployment Pipeline */}
            <DeploymentPipeline
                active={deployStep !== "idle"}
                currentStep={deployStep}
                result={deployResult}
                error={error ?? undefined}
                onNavigate={() => deployResult?.entityPath && navigate(deployResult.entityPath)}
                onRetry={() => { setDeployStep("idle"); setError(null) }}
                onClose={() => {
                    if (deployResult?.entityPath) navigate(deployResult.entityPath)
                    else { setDeployStep("idle"); setError(null) }
                }}
            />

            <ErrorToast message={deployStep === "idle" ? error : null} onDismiss={() => setError(null)} />
        </div>
    )
}

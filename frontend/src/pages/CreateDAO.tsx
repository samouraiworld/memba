import { useState, useCallback, useEffect, useRef } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { NotePencil } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DeploymentPipeline, type DeployStep, type DeploymentResult } from "../components/ui/DeploymentPipeline"
import { WizardStepPreset } from "../components/dao/WizardStepPreset"
import { WizardStepMembers } from "../components/dao/WizardStepMembers"
import { WizardStepConfig } from "../components/dao/WizardStepConfig"
import { WizardStepReview } from "../components/dao/WizardStepReview"
import { WizardStepExtensions } from "../components/dao/WizardStepExtensions"
import type { MemberInput, Step } from "../components/dao/wizardShared"
import { generateDAOCode, buildDeployDAOMsg, daoStepError, DAO_PRESETS, type DAOCreationConfig, type DAOPreset, type DAOStepData } from "../lib/daoTemplate"
import { generateChannelCode, defaultChannelConfig } from "../lib/channelTemplate"
import { buildDeployMsg } from "../lib/templates/prologue"
import { addSavedDAO, encodeSlug } from "../lib/daoSlug"
import { BECH32_PREFIX } from "../lib/config"
import { getGasConfig } from "../lib/gasConfig"
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

function loadDraft(): DraftData | null {
    try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (!raw) return null
        const draft: DraftData = JSON.parse(raw)
        if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
            localStorage.removeItem(DRAFT_KEY)
            return null
        }
        return draft
    } catch {
        localStorage.removeItem(DRAFT_KEY)
        return null
    }
}

function saveDraft(data: Omit<DraftData, "savedAt">) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
    } catch { /* quota exceeded — silently fail */ }
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY)
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
    const [showDraftBanner, setShowDraftBanner] = useState(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // ── Load draft on mount ───────────────────────────────

    useEffect(() => {
        const draft = loadDraft()
        if (draft) setShowDraftBanner(true)
    }, [])

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
        setStep(draft.step)
        setShowDraftBanner(false)
    }

    const discardDraft = () => {
        clearDraft()
        setShowDraftBanner(false)
    }

    // ── Auto-save draft (debounced 500ms) ─────────────────

    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
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
    }, [name, description, realmPath, members, threshold, quorum, availableRoles, proposalCategories, selectedPreset, step, enableChannels, channelNames])

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
                members: members.filter((m) => m.address.startsWith(BECH32_PREFIX)),
                votingPeriodBlocks: preset?.votingPeriodBlocks ?? 151200,
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
        if (!adena.address) { setError("Connect your wallet first"); return }
        setDeploying(true)
        setDeployStep("preparing")
        setError(null)
        try {
            const preset = DAO_PRESETS.find(p => p.id === selectedPreset)
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold, quorum, proposalCategories,
                roles: availableRoles,
                members: members.filter((m) => m.address.startsWith(BECH32_PREFIX)),
                votingPeriodBlocks: preset?.votingPeriodBlocks ?? 151200,
            }
            const code = generateDAOCode(config)
            const msg = buildDeployDAOMsg(adena.address, realmPath, code, "10000000ugnot")

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adenaWallet = (window as any).adena
            if (!adenaWallet?.DoContract) throw new Error("Adena wallet not available")

            const gas = getGasConfig()

            setDeployStep("signing")

            // TODO: Re-add 2 GNOT dev fee — test11 transfers now allowed (2026-04-09),
            // but needs on-chain testing before enabling. Add send amount to DoContract.
            const res = await adenaWallet.DoContract({
                messages: [{
                    type: "/vm.m_addpkg",
                    value: msg.value,
                }],
                gasFee: gas.fee,
                gasWanted: gas.deployWanted,
                memo: `Deploy DAO: ${name}`,
            })

            setDeployStep("broadcasting")

            if (res.status === "failure") {
                throw new Error(res.message || res.data?.message || "Deployment failed")
            }

            addSavedDAO(realmPath, name)

            // ── Deploy Channels companion realm if enabled (W1.5: hardened
            // channels path — boardTemplate is deprecated for new deploys) ──
            if (enableChannels) {
                setDeployStep("preparing")
                try {
                    const channelConfig = defaultChannelConfig(realmPath, name)
                    channelConfig.channels = channelNames.map((n) => ({
                        name: n, type: "text", acl: { readRoles: [], writeRoles: [] },
                    }))
                    // Seed the roster from the wizard's member step so role-gated
                    // channels work from block one; later DAO members are admitted
                    // via the realm's parent.IsMember() fallback.
                    channelConfig.members = config.members.map((m) => ({ address: m.address, roles: m.roles }))
                    const channelCode = generateChannelCode(channelConfig)
                    const channelMsg = buildDeployMsg(adena.address, channelConfig.channelRealmPath, channelCode, "10000000ugnot")
                    const channelRes = await adenaWallet.DoContract({
                        messages: [{ type: "/vm.m_addpkg", value: channelMsg.value }],
                        gasFee: gas.fee,
                        gasWanted: gas.deployWanted,
                        memo: `Deploy Channels for ${name}`,
                    })
                    if (channelRes.status === "failure") {
                        console.warn("[Memba] Channels deploy failed:", channelRes.message)
                        // Non-fatal: DAO is deployed, channels can be deployed later
                    }
                } catch (channelErr) {
                    console.warn("[Memba] Channels deploy error:", channelErr)
                    // Non-fatal: DAO was deployed successfully
                }
            }

            clearDraft()
            const slug = encodeSlug(realmPath)
            setDeployResult({
                realmPath,
                entityPath: `/dao/${slug}`,
                entityLabel: "DAO",
                entityName: name,
                txHash: res.data?.hash,
            })
            setDeployStep("complete")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Deployment failed")
            setDeployStep("error")
        } finally {
            setDeploying(false)
        }
    }

    // ── Derived ───────────────────────────────────────────

    const validMembers = members.filter((m) => m.address.startsWith(BECH32_PREFIX))
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
                    padding: "10px 14px", fontSize: 13,
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
                onClose={() => { setDeployStep("idle"); setError(null) }}
            />

            <ErrorToast message={deployStep === "idle" ? error : null} onDismiss={() => setError(null)} />
        </div>
    )
}

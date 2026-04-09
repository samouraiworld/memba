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
import { generateDAOCode, buildDeployDAOMsg, validateRealmPath, type DAOCreationConfig, type DAOPreset } from "../lib/daoTemplate"
import { generateBoardCode, buildDeployBoardMsg, defaultBoardConfig } from "../lib/boardTemplate"
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
    enableBoard: boolean
    boardChannels: string[]
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
    const [enableBoard, setEnableBoard] = useState(false)
    const [boardChannels, setBoardChannels] = useState<string[]>(["general"])
    const [deploying, setDeploying] = useState(false)
    const [deployStep, setDeployStep] = useState<DeployStep>("idle")
    const [deployResult, setDeployResult] = useState<DeploymentResult | undefined>()
    const [error, setError] = useState<string | null>(null)
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
        if (draft.enableBoard !== undefined) setEnableBoard(draft.enableBoard)
        if (draft.boardChannels) setBoardChannels(draft.boardChannels)
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
                    selectedPreset, step, enableBoard, boardChannels,
                })
            }
        }, 500)
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    }, [name, description, realmPath, members, threshold, quorum, availableRoles, proposalCategories, selectedPreset, step, enableBoard, boardChannels])

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

    const goToStep = (s: Step) => {
        setError(null)
        if (s === 5) {
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold, quorum, proposalCategories,
                roles: availableRoles,
                members: members.filter((m) => m.address.startsWith(BECH32_PREFIX)),
            }
            setGeneratedCode(generateDAOCode(config))
        }
        setStep(s)
    }

    // ── Validation ────────────────────────────────────────

    const validateStep = (): string | null => {
        if (step === 1) {
            if (!name.trim()) return "DAO name is required"
            if (name.length < 3) return "DAO name must be at least 3 characters"
            if (!realmPath.trim()) return "Realm path is required"
            const pathErr = validateRealmPath(realmPath)
            if (pathErr) return pathErr
        }
        if (step === 2) {
            const valid = members.filter((m) => m.address.startsWith(BECH32_PREFIX) && m.address.length >= 39)
            if (valid.length === 0) return "At least one member with a valid g1 address is required"
            const invalid = members.filter((m) => m.address.length > 0 && (!m.address.startsWith(BECH32_PREFIX) || m.address.length < 39))
            if (invalid.length > 0) return `${invalid.length} address(es) look invalid — must start with g1 and be 39+ characters`
            const hasAdmin = members.some((m) => m.address.startsWith(BECH32_PREFIX) && m.roles.includes("admin"))
            if (!hasAdmin) return "At least one member must have the admin role"
        }
        if (step === 3) {
            if (threshold < 1 || threshold > 100) return "Threshold must be between 1 and 100"
            if (quorum < 0 || quorum > 100) return "Quorum must be between 0 and 100"
        }
        return null
    }

    const nextStep = () => {
        const err = validateStep()
        if (err) { setError(err); return }
        goToStep((step + 1) as Step)
    }

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
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold, quorum, proposalCategories,
                roles: availableRoles,
                members: members.filter((m) => m.address.startsWith(BECH32_PREFIX)),
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

            addSavedDAO(realmPath)

            // ── Deploy Board companion realm if enabled ──
            if (enableBoard) {
                setDeployStep("preparing")
                try {
                    const boardConfig = defaultBoardConfig(realmPath, name)
                    boardConfig.channels = boardChannels
                    const boardCode = generateBoardCode(boardConfig)
                    const boardMsg = buildDeployBoardMsg(adena.address, boardConfig.boardRealmPath, boardCode, "10000000ugnot")
                    const boardRes = await adenaWallet.DoContract({
                        messages: [{ type: "/vm.m_addpkg", value: boardMsg.value }],
                        gasFee: gas.fee,
                        gasWanted: gas.deployWanted,
                        memo: `Deploy Board for ${name}`,
                    })
                    if (boardRes.status === "failure") {
                        console.warn("[Memba] Board deploy failed:", boardRes.message)
                        // Non-fatal: DAO is deployed, board can be deployed later
                    }
                } catch (boardErr) {
                    console.warn("[Memba] Board deploy error:", boardErr)
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
                    enableBoard={enableBoard} boardChannels={boardChannels}
                    onEnableBoardChange={setEnableBoard} onBoardChannelsChange={setBoardChannels}
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

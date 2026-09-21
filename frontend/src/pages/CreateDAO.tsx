import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
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
import { daoDepositCapUgnot, deployGasForPolicy, estimateDAODepositUgnot, formatGnot } from "../lib/templates/dao/v2/deposit"
import { saveDAOForRecovery, encodeSlug } from "../lib/daoSlug"
import { doContractBroadcast, feeForGasWanted, networkGasPrice, FALLBACK_GAS_PRICE, type GasPrice } from "../lib/grc20"
import { getGasConfig } from "../lib/gasConfig"
import { getRpcUrlsInOrder } from "../lib/rpcFallback"
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GNO_RPC_URL, NETWORKS } from "../lib/config"
import { assertCanDeployTo } from "../lib/dao/namespace"
import { assertPathAvailable, codeSubmissionPolicy, listPendingDAOs, hasVolatilePendingDAO, removePendingDAO, savePendingDAO, waitForPackage, type DeployOutcome } from "../lib/dao/packageStatus"
import type { LayoutContext } from "../types/layout"
import { loadDraft, saveDraft, clearDraft, adoptDraft, draftKey, discardDraftAtKey } from "../lib/dao/drafts"
import { beginSubmission, isSubmissionActive, submissionKey, subscribeSubmissions } from "../lib/dao/submissionActivity"
import { useOrg } from "../contexts/OrgContext"
import "./createdao.css"

const STEP_LABELS: Record<Step, string> = {
    1: "Name, Path & Preset",
    2: "Members & Roles",
    3: "Governance Settings",
    4: "Extensions",
    5: "Review & Deploy",
}

// ── Draft Persistence ─────────────────────────────────────

/** Voting period, delay and window of the chosen preset (Basic when none). */
function presetWindows(preset: DAOPreset | undefined): Pick<DAOCreationConfig, "votingPeriodSeconds" | "executionDelaySeconds" | "executionWindowSeconds"> {
    const p = preset ?? DAO_PRESETS[0]
    return { votingPeriodSeconds: p.votingPeriodSeconds, executionDelaySeconds: p.executionDelaySeconds, executionWindowSeconds: p.executionWindowSeconds }
}

/** What this network offers for user-created DAOs. */
function userDaoCapabilities() {
    const network = NETWORKS[ACTIVE_NETWORK_KEY]
    return {
        label: network?.label ?? GNO_CHAIN_ID,
        create: network?.userDaos?.create === true,
        channelsCompanion: network?.userDaos?.channelsCompanion === true,
    }
}

type Approval =
    | { phase: "waiting"; txHash: string }
    | { phase: "pending"; txHash: string; reason: string; status: "unknown" | "inert" | "absent"; canRepair?: boolean }

// ── Main Component (Orchestrator) ─────────────────────────

export function CreateDAO() {
    const { adena } = useOutletContext<LayoutContext>()
    const { activeOrgId } = useOrg()
    const [revision, setRevision] = useState(0)
    return <CreateDAOWizard key={`${GNO_CHAIN_ID}:${adena.address || "unbound"}:${activeOrgId || "personal"}:${revision}`} onReset={() => setRevision(n => n + 1)} />
}

function CreateDAOWizard({ onReset }: { onReset: () => void }) {
    const navigate = useNetworkNav()
    const { adena } = useOutletContext<LayoutContext>()
    const { activeOrgId } = useOrg()
    const mounted = useRef(false)
    const polling = useRef<AbortController | null>(null)
    useEffect(() => {
        mounted.current = true
        polling.current = new AbortController()
        return () => { mounted.current = false; polling.current?.abort() }
    }, [])
    const assertCurrent = () => { if (!mounted.current) throw new Error("Wallet or workspace changed. Review the deployment again before signing.") }
    const bookmark = (path: string, label: string) => saveDAOForRecovery(activeOrgId, path, label)
    const caps = userDaoCapabilities()
    const draftContext = useMemo(() => ({ chainId: GNO_CHAIN_ID, wallet: adena.address || "" }), [adena.address])

    const [recovery] = useState(() => {
        const draft = loadDraft(draftContext)
        return draft ? listPendingDAOs(GNO_CHAIN_ID).find(p => p.path === draft.data.realmPath && (!p.wallet || p.wallet === adena.address)) : undefined
    })

    // Wizard state — shared across steps
    const [step, setStep] = useState<Step>(recovery ? 5 : 1)
    const [name, setName] = useState(recovery?.name ?? "")
    const [description, setDescription] = useState("")
    const [realmPath, setRealmPath] = useState(recovery?.path ?? "")
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
    const [approval, setApproval] = useState<Approval | null>(recovery ? { phase: "pending", status: "unknown", txHash: recovery.txHash, reason: "A previous submission attempt is saved. Check the network before trying again." } : null)
    const [acknowledgeRecovery, setAcknowledgeRecovery] = useState(false)
    const activityKey = submissionKey(GNO_CHAIN_ID, realmPath)
    const activeSubmission = useSyncExternalStore(subscribeSubmissions, () => isSubmissionActive(activityKey))
    const [confirmed, setConfirmed] = useState(false)
    const [replacesParked, setReplacesParked] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Step-validation messages are shown as a gentle inline notice — NOT routed
    // through the system ErrorToast, which dramatizes "name required" into
    // "Something went wrong / reload the page".
    const [validationError, setValidationError] = useState<string | null>(null)
    const [generatedCode, setGeneratedCode] = useState("")
    // Lazy initializer, not a mount effect: whether a draft exists is known
    // synchronously from localStorage at first render.
    const [draftCandidate] = useState(() => loadDraft(draftContext))
    const [showDraftBanner, setShowDraftBanner] = useState(!!draftCandidate && !recovery)
    const [confirmReset, setConfirmReset] = useState(false)
    const [draftWarning, setDraftWarning] = useState<string | null>(null)
    const [gasPrice, setGasPrice] = useState<GasPrice>(FALLBACK_GAS_PRICE)

    useEffect(() => {
        let active = true
        networkGasPrice().then((price) => { if (active) setGasPrice(price) })
        return () => { active = false }
    }, [])

    const windows = presetWindows(DAO_PRESETS.find(p => p.id === selectedPreset))
    const channelsPlanned = caps.channelsCompanion && enableChannels

    const resumeDraft = () => {
        const candidate = loadDraft(draftContext)
        if (!candidate) return
        let draft
        try { draft = adoptDraft(draftContext, candidate) }
        catch { setDraftWarning("This browser could not save your draft. The original is still available; enable browser storage before resuming."); return }
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
        setConfirmed(false)
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
        try {
            discardDraftAtKey(showDraftBanner && draftCandidate ? draftCandidate.key : draftKey(draftContext))
            onReset()
        } catch { setDraftWarning("This browser could not discard your draft. Your input has been kept.") }
    }

    // Save each edit under its original chain/account, without a debounce window
    // that could lose the final edit when a wallet switch remounts this wizard.
    useEffect(() => {
        if (showDraftBanner || deploying || deployResult || approval) return
        if (name || realmPath || members.some(m => m.address)) {
            try {
                saveDraft(draftContext, {
                    name, description, realmPath, members, threshold, quorum, availableRoles,
                    proposalCategories, selectedPreset, step, enableChannels, channelNames,
                })
            } catch {
                // eslint-disable-next-line react-hooks/set-state-in-effect -- report a failed persistence operation.
                setDraftWarning("Changes cannot be saved in this browser. Keep this page open and copy your settings before leaving.")
            }
        }
    }, [draftContext, name, description, realmPath, members, threshold, quorum, availableRoles, proposalCategories, selectedPreset, step, enableChannels, channelNames, showDraftBanner, deploying, deployResult, approval])

    // ── Preset ────────────────────────────────────────────

    const applyPreset = (preset: DAOPreset) => {
        setSelectedPreset(preset.id)
        setAvailableRoles(preset.roles)
        setThreshold(preset.threshold)
        setQuorum(preset.quorum)
        setProposalCategories(preset.categories)
        setMembers((prev) => prev.map((m, i) => i === 0 ? { ...m, roles: ["admin"] } : { ...m, roles: ["member"] }))
    }

    // ── Navigation ────────────────────────────────────────

    const autoFillPath = () => {
        if (!adena.address) return
        setRealmPath(`gno.land/r/${adena.address}/${name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20) || "mydao"}`)
    }

    const buildStepData = (): DAOStepData => ({ name, realmPath, members, threshold, quorum })

    const buildConfig = (): DAOCreationConfig => ({
        name, description, realmPath, threshold, quorum, proposalCategories,
        roles: availableRoles,
        members: members.filter((m) => m.address !== ""),
        ...windows,
    })

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
            // Codegen is fail-closed and throws on invalid input. Steps should
            // have caught everything, but never crash the wizard.
            try {
                setGeneratedCode(generateDAOCode(buildConfig()))
                setConfirmed(false)
            } catch (err) {
                setValidationError(err instanceof Error ? err.message : String(err))
                return
            }
        }
        setStep(s)
    }

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

    // ── Deposit ───────────────────────────────────────────

    const depositInput = { name, description, roles: availableRoles, proposalCategories, members: members.filter((m) => m.address !== "") }
    const depositEstimateUgnot = estimateDAODepositUgnot(depositInput)
    const depositCapUgnot = daoDepositCapUgnot(depositInput)

    // ── Deploy ────────────────────────────────────────────

    // Chain checks walk the network's endpoint list (each endpoint must serve this chain).
    const chain = useMemo(() => ({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, rpcUrls: getRpcUrlsInOrder() }), [])

    // The submission policy sizes the deploy: under "inert" AddPackage only
    // stores the package. An unknown policy uses the larger full-deploy model.
    const [submissionPolicy, setSubmissionPolicy] = useState("unknown")
    useEffect(() => {
        let active = true
        codeSubmissionPolicy(chain).then((p) => { if (active) setSubmissionPolicy(p) }, () => {})
        return () => { active = false }
    }, [chain])

    // The deploy runs with a gas budget sized to the DAO so a large roster
    // cannot run out of gas after the user signed.
    const deployGas = deployGasForPolicy(depositInput, submissionPolicy)
    const networkFeeUgnot = feeForGasWanted(deployGas, gasPrice)

    const deployDAO = async () => {
        if (deploying || deployResult || approval || isSubmissionActive(activityKey)) return
        const existing = listPendingDAOs(GNO_CHAIN_ID).find(p => p.path === realmPath)
        if (existing) {
            setApproval({ phase: "pending", status: "unknown", txHash: existing.txHash, reason: "A submission attempt is already recorded. Check its status before trying again." })
            return
        }
        if (!caps.create) { setError(`Creating a DAO is not available on ${caps.label} yet`); return }
        if (!adena.address) { setError("Connect your wallet first"); return }
        if (!confirmed) { setError("Confirm that you understand this deploys a permanent contract"); return }
        const releaseSubmission = beginSubmission(activityKey)
        setDeploying(true)
        setDeployStep("preparing")
        setError(null)
        let confirmedTx = ""
        let intentSaved = false
        let walletStarted = false
        const intent = { chainId: GNO_CHAIN_ID, path: realmPath, name, wallet: adena.address, orgId: activeOrgId, txHash: "", phase: "intent" as const, reason: "Wallet outcome unknown; check the package before resubmitting." }
        const draftBefore = JSON.stringify(loadDraft(draftContext)?.data)
        const clearSubmittedDraft = () => {
            if (JSON.stringify(loadDraft(draftContext)?.data) === draftBefore) clearDraft(draftContext)
        }
        try {
            for (const step of [1, 2, 3]) {
                const error = daoStepError(step, buildStepData())
                if (error) throw new Error(error)
            }
            const config = buildConfig()
            const code = generateDAOCode(config)
            const cap = daoDepositCapUgnot(config)
            const maxDeposit = `${cap}ugnot`
            const msg = buildDeployDAOMsg(adena.address, realmPath, code, maxDeposit)

            // Validate the companion before the first wallet request. A local
            // extension error must not leave an unexpectedly partial deployment.
            let channelMsg: ReturnType<typeof buildDeployMsg> | undefined
            if (channelsPlanned) {
                if (channelNames.length < 1 || channelNames.length > 5 ||
                    channelNames.some(n => !isValidChannelName(n)) || new Set(channelNames).size !== channelNames.length) {
                    throw new Error("Choose one to five valid, distinct channel names before deploying")
                }
                const channelConfig = defaultChannelConfig(realmPath, name)
                channelConfig.channels = channelNames.map(n => ({ name: n, type: "text", acl: { readRoles: [], writeRoles: [] } }))
                channelConfig.members = config.members.map(m => ({ address: m.address, roles: m.roles }))
                channelMsg = buildDeployMsg(adena.address, channelConfig.channelRealmPath, generateChannelCode(channelConfig), maxDeposit)
            }

            // The chain decides: the signer must own the namespace and the
            // path must be unused (live or waiting for approval).
            await assertCanDeployTo(chain, adena.address, realmPath)
            const { replacesParked: replacing } = await assertPathAvailable(chain, realmPath, adena.address)
            setReplacesParked(replacing)
            // The policy only sizes the transaction; success is read from the chain.
            const policy = await codeSubmissionPolicy(chain).catch(() => "unknown")

            assertCurrent()
            // Durable intent precedes any wallet prompt: a lost response/reload
            // must leave enough context to reconcile without resubmitting.
            savePendingDAO(intent)
            intentSaved = true
            setDeployStep("signing")
            const res = await doContractBroadcast(
                [{ type: "/vm.m_addpkg", value: msg.value }],
                `Deploy realm ${realmPath} (storage deposit up to ${formatGnot(cap)})${replacing ? "; replaces your earlier submission that gno.land has not enabled" : ""}`,
                { gas: "deploy", gasWanted: deployGasForPolicy(config, policy), beforeSign: () => { assertCurrent(); walletStarted = true } },
            )
            confirmedTx = res.hash
            setDeployStep("broadcasting")

            // Under the inert policy a confirmed submission is parked until an
            // approver enables it: only "live" is a created DAO.
            // Record it before polling: closing the tab must not lose the DAO.
            try {
                savePendingDAO({ ...intent, phase: "submitted", txHash: res.hash, reason: "Wallet returned; checking package status" })
            } catch { /* the waiting panel still shows the path and transaction */ }
            // Whatever the policy says, the DAO exists only once its package is
            // live. The first read returns at once when it already is.
            if (policy === "inert") {
                setDeployStep("idle")
                setApproval({ phase: "waiting", txHash: res.hash })
            }
            if (!mounted.current) return
            const outcome: DeployOutcome = await waitForPackage(chain, realmPath, { signal: polling.current?.signal })
            if (!mounted.current) return
            if (outcome.outcome === "pending") setDeployStep("idle")

            if (outcome.outcome === "pending") {
                const reason = outcome.unconfirmed
                    ? "the network status could not be read yet"
                    : outcome.meta?.reason ?? "waiting for a package approver to enable it"
                try {
                    savePendingDAO({ ...intent, phase: "submitted", txHash: res.hash, reason })
                } catch { /* the pending panel still shows the path and transaction */ }
                setApproval({ phase: "pending", txHash: res.hash, reason, status: outcome.unconfirmed ? "unknown" : "inert", canRepair: !outcome.unconfirmed && outcome.meta?.creator === adena.address })
                return
            }
            setApproval(null)
            if (outcome.outcome === "failed") {
                setDeployStep("idle")
                setApproval({ phase: "pending", status: "absent", txHash: res.hash, reason: outcome.error })
                return
            }

            // Preserve the confirmed primary result even if a later wallet
            // request or local-storage write fails. Never offer to redeploy it.
            const result: DeploymentResult = {
                realmPath, entityPath: `/dao/${encodeSlug(realmPath)}`,
                entityLabel: "DAO", entityName: name, txHash: res.hash,
            }
            const warnings: string[] = []
            setDeployResult(result)
            try { bookmark(realmPath, name); removePendingDAO(GNO_CHAIN_ID, realmPath) } catch {
                warnings.push("Your DAO was created, but could not be saved in this browser. Keep its realm path.")
            }
            clearSubmittedDraft()

            if (channelMsg && mounted.current) {
                setDeployStep("signing")
                try {
                    await doContractBroadcast(
                        [{ type: "/vm.m_addpkg", value: channelMsg.value }],
                        `Deploy Channels for ${name}`, { gas: "deploy", beforeSign: assertCurrent },
                    )
                } catch (channelErr) {
                    warnings.push(`Channels deployment was not confirmed: ${friendlyError(channelErr)}. Your DAO is already created. Check the Channels realm before attempting a separate deployment.`)
                }
            }

            setDeployResult({ ...result, warnings })
            setDeployStep("complete")
        } catch (err) {
            // Before signing, cancellation is known. Once Adena was invoked,
            // even cancellation-worded errors can be transport failures.
            if (intentSaved && !walletStarted) {
                try { removePendingDAO(GNO_CHAIN_ID, realmPath) } catch { /* Keep the recoverable intent. */ }
            } else if (intentSaved) {
                if (mounted.current) {
                    setApproval({ phase: "pending", status: "unknown", txHash: confirmedTx, reason: "The wallet outcome could not be confirmed. Check the network before resubmitting." })
                    setDeployStep("idle")
                }
                return
            }
            if (!mounted.current) return
            setApproval(null)
            // friendlyError may replace the message entirely: keep the hash of a
            // confirmed transaction outside it so the user can always find it.
            setError(confirmedTx ? `${friendlyError(err)} Transaction: ${confirmedTx}` : friendlyError(err))
            setDeployStep("error")
        } finally {
            releaseSubmission()
            if (mounted.current) setDeploying(false)
        }
    }

    // ── Derived ───────────────────────────────────────────

    const validMembers = members.filter((m) => isValidGnoAddress(m.address))
    const totalPower = validMembers.reduce((sum, m) => sum + m.power, 0)

    // ── Render ────────────────────────────────────────────

    if (!caps.create) {
        return (
            <div className="animate-fade-in cdao-page">
                <button id="create-dao-back-btn" aria-label="Back to DAO list" onClick={() => navigate("/dao")} className="cdao-back-btn">
                    ← Back to DAOs
                </button>
                <div className="k-card" role="status" style={{ padding: 20 }}>
                    <h2 className="cdao-title">Create a DAO</h2>
                    <p className="cdao-subtitle">Creating a DAO is not available on {caps.label} yet.</p>
                </div>
            </div>
        )
    }

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

            {draftWarning && <p role="status">{draftWarning}</p>}
            {hasVolatilePendingDAO(GNO_CHAIN_ID, realmPath) && <p role="alert">This submission could not be saved to browser storage. Keep this tab open and copy the realm path and any transaction hash before leaving.</p>}
            {confirmReset && <div className="k-card" role="alertdialog" aria-label="Discard DAO draft">
                <p>Discard this draft and start again? This cannot be undone.</p>
                <button className="k-btn-secondary" onClick={() => setConfirmReset(false)}>Keep draft</button>
                <button className="k-btn-primary" onClick={discardDraft}>Confirm discard</button>
            </div>}
            {!showDraftBanner && !deploying && !deployResult && !approval && (name || realmPath) &&
                <button className="k-btn-secondary" onClick={() => setConfirmReset(true)}>Reset draft</button>}
            {/* Draft resume banner */}
            {showDraftBanner && (
                <div className="k-card cdao-draft-banner">
                    <div className="cdao-draft-banner__info">
                        <span className="cdao-draft-banner__icon"><NotePencil size={16} /></span>
                        <span className="cdao-draft-banner__text">
                            {draftCandidate?.needsAdoption ? `Use this older or disconnected draft on ${caps.label} with ${adena.address || "no connected wallet"}? Review the path and members before deploying.` : `You have a saved draft on ${caps.label} for ${adena.address || "this disconnected session"}.`}
                        </span>
                    </div>
                    <div className="cdao-draft-banner__actions">
                        <button className="k-btn-primary" onClick={resumeDraft}>
                            Resume
                        </button>
                        <button className="k-btn-secondary" onClick={() => setConfirmReset(true)}>
                            Discard
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div>
                <h2 className="cdao-title">
                    Create a DAO
                </h2>
                <p className="cdao-subtitle">
                    Deploy a new governance realm on {caps.label}
                </p>
            </div>

            {/* Step indicator */}
            <nav className="cdao-steps" aria-label="Create DAO steps">
                {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className="cdao-step-group">
                        <button
                            type="button"
                            className={`cdao-step-circle ${s === step ? "cdao-step-circle--active" : s < step ? "cdao-step-circle--done" : "cdao-step-circle--future"}`}
                            onClick={() => s < step && !deploying && !approval && goToStep(s as Step)}
                            disabled={s >= step || deploying || !!approval}
                            aria-current={s === step ? "step" : undefined}
                            aria-label={`Step ${s}: ${STEP_LABELS[s as Step]}${s < step ? " (done, go back)" : ""}`}
                        >
                            {s < step ? "✓" : s}
                        </button>
                        {s < 5 && <div className={`cdao-step-connector ${s < step ? "cdao-step-connector--done" : "cdao-step-connector--future"}`} />}
                    </div>
                ))}
                <span className="cdao-step-label">{STEP_LABELS[step]}</span>
            </nav>

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
                    totalPower={totalPower} threshold={threshold} quorum={quorum}
                    onMembersChange={setMembers} onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 3: Governance Settings */}
            {step === 3 && (
                <WizardStepConfig
                    threshold={threshold} quorum={quorum}
                    proposalCategories={proposalCategories} validMembers={validMembers}
                    totalPower={totalPower} windows={windows} onThresholdChange={setThreshold}
                    onQuorumChange={setQuorum} onToggleCategory={toggleCategory}
                    onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 4: Extensions */}
            {step === 4 && (
                <WizardStepExtensions
                    enableChannels={channelsPlanned} channelsAvailable={caps.channelsCompanion} channelNames={channelNames}
                    onEnableChannelsChange={setEnableChannels} onChannelNamesChange={setChannelNames}
                    onGoToStep={goToStep} onNext={nextStep}
                />
            )}

            {/* Step 5: Review & Deploy */}
            {step === 5 && !approval && (
                <WizardStepReview
                    name={name} description={description} realmPath={realmPath}
                    selectedPreset={selectedPreset} threshold={threshold} quorum={quorum}
                    availableRoles={availableRoles} proposalCategories={proposalCategories}
                    validMembers={validMembers} totalPower={totalPower}
                    generatedCode={generatedCode} deploying={deploying}
                    walletAddress={adena.address}
                    networkLabel={caps.label} chainId={GNO_CHAIN_ID} windows={windows}
                    depositEstimateUgnot={depositEstimateUgnot} depositCapUgnot={depositCapUgnot}
                    deployGas={deployGas} networkFeeUgnot={networkFeeUgnot} channelsFeeUgnot={getGasConfig().fee}
                    channelsPlanned={channelsPlanned}
                    confirmed={confirmed} onConfirmChange={setConfirmed}
                    onGoToStep={goToStep} onDeploy={deployDAO}
                />
            )}

            {replacesParked && (
                <div className="k-card" role="note" data-testid="dao-replaces-parked" style={{ padding: 12, fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                    Replaces your earlier submission that gno.land has not enabled.
                </div>
            )}

            {/* Waiting for the network to enable the package (inert policy) */}
            {approval?.phase === "waiting" && (
                <div className="k-card" role="status" data-testid="dao-approval-waiting" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>Waiting for network approval</h3>
                    <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                        Your wallet returned a transaction response. Memba is checking whether {caps.label} has enabled the package.
                    </p>
                    <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                        {realmPath} {approval.txHash ? `· TX ${approval.txHash}` : "· No transaction hash was returned"}
                    </p>
                </div>
            )}

            {approval?.phase === "pending" && (
                <div className="k-card" role="status" data-testid="dao-approval-pending" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>{approval.status === "inert" ? "Submitted, not enabled yet" : approval.status === "absent" ? "Package not found" : "Submission status unknown"}</h3>
                    <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                        {approval.status === "inert" ? "The package is stored but has not been enabled. It becomes usable only once the network enables it." : approval.status === "absent" ? "The network currently has no package at this path. Check the transaction before attempting another submission." : "The package status is not confirmed. This does not mean it failed or is waiting for approval. Check again before resubmitting."}
                    </p>
                    <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>Network status: {approval.reason}</p>
                    {activeSubmission && <p role="status">A submission is still in progress. Finish the wallet request before checking or starting another attempt.</p>}
                    <button className="k-btn-secondary" disabled={deploying || activeSubmission} onClick={async () => {
                        setDeploying(true)
                        try {
                            const receipt = listPendingDAOs(GNO_CHAIN_ID).find(p => p.path === realmPath)
                            const knownHash = receipt?.txHash || approval.txHash
                            const outcome = await waitForPackage(chain, realmPath, { timeoutMs: 0, signal: polling.current?.signal })
                            if (!mounted.current) return
                            if (outcome.outcome === "live") {
                                saveDAOForRecovery(receipt?.orgId ?? null, realmPath, name)
                                removePendingDAO(GNO_CHAIN_ID, realmPath)
                                setApproval(null)
                                setDeployResult({ realmPath, entityPath: `/dao/${encodeSlug(realmPath)}`, entityLabel: "DAO", entityName: name, txHash: knownHash })
                                setDeployStep("complete")
                                clearDraft(draftContext)
                            } else {
                                setAcknowledgeRecovery(false)
                                setApproval({ ...approval, txHash: knownHash, canRepair: outcome.outcome === "pending" && !outcome.unconfirmed && outcome.meta?.creator === adena.address, status: outcome.outcome === "failed" ? "absent" : outcome.unconfirmed ? "unknown" : "inert", reason: outcome.outcome === "failed" ? outcome.error : outcome.meta?.reason ?? "Status could not be confirmed" })
                            }
                        } catch { if (mounted.current) setError("Could not save the recovered DAO. Its submission record is retained; check again.") }
                        finally { if (mounted.current) setDeploying(false) }
                    }}>Check status</button>
                    {(approval.status === "absent" || approval.canRepair) && <div>
                        <p>{activeSubmission ? "A wallet request or status check is still in progress. Finish it before starting another attempt." : approval.canRepair ? "This wallet owns the parked package. You can review a replacement; it will require a new signature and deposit check." : "Only continue after checking the transaction in your wallet or explorer. An absent package alone does not prove the transaction cannot still arrive."}</p>
                        <label><input type="checkbox" checked={acknowledgeRecovery} disabled={activeSubmission} onChange={e => setAcknowledgeRecovery(e.target.checked)} /> I checked the transaction and want to review a new submission.</label>
                        <button className="k-btn-secondary" disabled={activeSubmission || deploying || !acknowledgeRecovery} onClick={async () => {
                            if (isSubmissionActive(activityKey)) return
                            setDeploying(true)
                            try {
                                // Revalidate immediately before releasing the saved attempt.
                                await assertCanDeployTo(chain, adena.address, realmPath)
                                await assertPathAvailable(chain, realmPath, adena.address)
                                assertCurrent()
                                if (isSubmissionActive(activityKey)) throw new Error("This submission is still in progress")
                                removePendingDAO(GNO_CHAIN_ID, realmPath)
                                onReset() // The saved form still requires a fresh permanent-contract confirmation.
                            } catch (err) { if (mounted.current) setError(friendlyError(err)) }
                            finally { if (mounted.current) setDeploying(false) }
                        }}>Review another attempt</button>
                    </div>}
                    <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                        {realmPath} {approval.txHash ? `· TX ${approval.txHash}` : "· No transaction hash was returned"}
                    </p>
                </div>
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

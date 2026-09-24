/**
 * The Create DAO wizard (mockup v4 FLOWS.dao): Basics → Members → Rules →
 * Extras → Review, with a live "Your DAO" preview and an automatic draft.
 * The Review step runs the chain checks up front; signing goes through the
 * Memba review sheet (createDaoRequest), and the result is read from the
 * chain: live, waiting for network approval (gnoland-1), or failed. A saved
 * submission for the address locks the deploy until it is checked, as on the
 * classic page.
 *
 * @module os/daos/CreateDaoWizard
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { assertCanDeployTo } from "../../lib/dao/namespace"
import { assertPathAvailable, listPendingDAOs, removePendingDAO, waitForPackage } from "../../lib/dao/packageStatus"
import { isSubmissionActive, submissionKey, subscribeSubmissions } from "../../lib/dao/submissionActivity"
import { saveDAOForRecovery } from "../../lib/daoSlug"
import { DAO_DESCRIPTION_MAX, DAO_NAME_MAX, DAO_PRESETS, DAO_REALM_LIMITS } from "../../lib/daoTemplate"
import { friendlyError } from "../../lib/errorMessages"
import { FALLBACK_GAS_PRICE, networkGasPrice, type GasPrice } from "../../lib/grc20"
import { formatGnot } from "../../lib/templates/dao/v2/deposit"
import { shortAddr } from "../shell/format"
import { ThingTile } from "../shell/icons"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { Field, WizardFrame } from "../wizard/WizardFrame"
import {
    applyPreset, categoryChoices, clearDaoDraft, DAO_STEPS, daoConfig, daoDraftError, emptyDaoDraft, firstInvalidStep,
    formatSeconds, presetById, readDaoDraft, realmPathFor, saveDaoDraft, soloMembers, totalPower, userDaoCapabilities, type DaoDraft,
} from "./createDao"
import { createDaoRequest, deployChain, deployCosts, runDeployChecks, type DeployChecks, type DeployResult } from "./createDaoRequest"
import { nameForRealm } from "./daoNames"

const DAO_TINT = ["#2FC08E", "#12A07A"] as const

function Gate({ children }: { children: ReactNode }) {
    return <div className="os-holding"><ThingTile icon="folder" tint={DAO_TINT} size={44} /><div className="os-stack os-tight">{children}</div></div>
}

export function CreateDaoWizard({ session, open, close }: { session: OsSession; open: (spec: WindowSpec) => void; close: () => void }) {
    const caps = userDaoCapabilities()
    if (!caps.create) return <Gate><b>Creating a DAO is not available on {caps.label} yet.</b></Gate>
    if (session.status !== "member") {
        return <Gate><b>Connect a wallet to create a DAO.</b><span className="os-sub">The wallet you connect deploys the DAO and becomes its first admin.</span><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></Gate>
    }
    // Keyed by network and wallet: a draft and a saved submission belong to one wallet.
    return <Wizard key={`${GNO_CHAIN_ID}:${session.address}`} wallet={session.address} open={open} close={close} />
}

type Outcome =
    | { kind: "submitted"; hash: string }
    | { kind: "result"; result: DeployResult; hash: string }
    | { kind: "unknown" }

type Checked = { key: string; checks: DeployChecks } | { key: string; error: string }

function Wizard({ wallet, open, close }: { wallet: string; open: (spec: WindowSpec) => void; close: () => void }) {
    const signer = useSigner()
    const [draft, setDraft] = useState<DaoDraft>(() => readDaoDraft(GNO_CHAIN_ID, wallet) ?? emptyDaoDraft(wallet))
    // A submission saved for the draft's address opens on the Review step, where it's checked.
    const [step, setStep] = useState(() => (listPendingDAOs(GNO_CHAIN_ID).some((p) => p.path === realmPathFor(wallet, draft.name)) ? DAO_STEPS.length - 1 : 0))
    const [error, setError] = useState<string | null>(null)
    const [ack, setAck] = useState(false)
    const [price, setPrice] = useState<GasPrice>(FALLBACK_GAS_PRICE)
    const [checked, setChecked] = useState<Checked | null>(null)
    const [checkRev, setCheckRev] = useState(0)
    const [outcome, setOutcome] = useState<Outcome | null>(null)
    const [, rerender] = useState(0)

    const path = realmPathFor(wallet, draft.name)
    const preset = presetById(draft.preset)
    const config = useMemo(() => daoConfig(draft, wallet), [draft, wallet])
    const onReview = step === DAO_STEPS.length - 1
    const checkKey = `${path}|${checkRev}`
    const current = checked?.key === checkKey ? checked : null

    // The automatic draft (D18). A finished deploy clears it.
    useEffect(() => { if (!outcome) saveDaoDraft(GNO_CHAIN_ID, wallet, draft) }, [wallet, draft, outcome])

    useEffect(() => {
        let active = true
        networkGasPrice().then((p) => { if (active) setPrice(p) }, () => {})
        return () => { active = false }
    }, [])

    // The chain checks run as the Review step opens (mockup: "✓ You can publish under this address · ✓ The address is free").
    useEffect(() => {
        if (!onReview) return
        let active = true
        runDeployChecks(wallet, path).then(
            (checks) => { if (active) setChecked({ key: checkKey, checks }) },
            (err: unknown) => { if (active) setChecked({ key: checkKey, error: friendlyError(err) }) },
        )
        return () => { active = false }
    }, [onReview, wallet, path, checkKey])

    const activity = submissionKey(GNO_CHAIN_ID, path)
    const inFlight = useSyncExternalStore(subscribeSubmissions, () => isSubmissionActive(activity))
    const saved = listPendingDAOs(GNO_CHAIN_ID).find((p) => p.path === path && (!p.wallet || p.wallet === wallet))

    const set = (patch: Partial<DaoDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }
    const setMember = (i: number, patch: Partial<DaoDraft["members"][number]>) => set({ members: draft.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
    const openDao = () => {
        const name = nameForRealm(path)
        close()
        if (name) open(daoSpec(name))
    }

    // ── After the wallet returned: the deploy's status, as the classic pipeline ──
    if (outcome && outcome.kind !== "unknown") {
        const hash = outcome.hash
        const res = outcome.kind === "result" ? outcome.result : null
        const inert = current && "checks" in current && current.checks.policy === "inert"
        const title = !res ? (inert ? "Submitted · waiting for network approval" : "Deploying…")
            : res.kind === "live" ? "Your DAO is live"
                : res.kind === "pending" ? (res.unconfirmed ? "Submitted · status unknown" : "Submitted · waiting for network approval")
                    : "Package not found"
        return (
            <div className="os-stack" role="status" aria-live="polite">
                <div className="os-row">{!res && <span className="os-spin" aria-hidden="true" />}<h3 className="os-rv-title">{title}</h3></div>
                <ol className="os-pipe">
                    <li className="os-done">Checked the address</li>
                    <li className="os-done">Signed in Adena</li>
                    <li className={res?.kind === "live" ? "os-done" : "os-cur"}>{res?.kind === "live" ? "Package live" : inert || res?.kind === "pending" ? "Waiting for network approval" : "Checking the network"}</li>
                </ol>
                {res?.kind === "live" && <p className="os-note os-ok">Members can make proposals right away.</p>}
                {(res?.kind === "pending" && !res.unconfirmed) || (!res && inert)
                    ? <p className="os-note os-warn">gno.land reviews new packages before they go live. Your DAO becomes usable once the network enables it. Nothing else to do.</p> : null}
                {res?.kind === "pending" && res.unconfirmed && <p className="os-note os-warn">The package status couldn't be read yet. This doesn't mean it failed. Check again before deploying anything else to this address.</p>}
                {res?.kind === "failed" && <p className="os-note os-err">{res.error}. Check the transaction before trying again.</p>}
                <code className="os-mono os-break os-sub">{path}{hash ? ` · Transaction ${hash}` : ""}</code>
                <div className="os-row os-end">
                    {res?.kind === "live" ? <button type="button" className="os-btn" onClick={openDao}>Open DAO</button>
                        : res ? <button type="button" className="os-btn os-quiet" onClick={() => { setOutcome(null); rerender((x) => x + 1) }}>Check status</button> : null}
                </div>
            </div>
        )
    }

    // ── A saved submission for this address locks the deploy until it is checked ──
    if (saved && onReview) {
        return <SavedSubmission wallet={wallet} path={path} name={draft.name} txHash={saved.txHash} orgId={saved.orgId ?? null} inFlight={inFlight}
            unknown={outcome?.kind === "unknown"}
            onLive={() => { clearDaoDraft(GNO_CHAIN_ID, wallet); setOutcome({ kind: "result", result: { kind: "live" }, hash: saved.txHash }) }}
            onReleased={() => { setOutcome(null); setAck(false); setCheckRev((r) => r + 1) }} />
    }

    const costs = current && "checks" in current ? deployCosts(config, current.checks.policy, price) : deployCosts(config, "unknown", price)
    const solo = soloMembers(draft)
    const total = totalPower(draft)
    const reviewLines: [string, string][] = [
        ["Address", path],
        ["Rules", `${draft.threshold} % yes${draft.quorum ? `, ${draft.quorum} % quorum` : ""} · votes last ${formatSeconds(preset.votingPeriodSeconds)}`],
        ["Members", config.members.map((m) => `${shortAddr(m.address)} (${m.power}, ${m.roles.join(", ")})`).join(" · ")],
        ["Storage deposit", `≈ ${formatGnot(costs.estimateUgnot)} (cap ${formatGnot(costs.capUgnot)})`],
        ["Network fee", `up to ${formatGnot(costs.feeUgnot)}`],
        ["Network", GNO_CHAIN_ID],
    ]
    const reviewWarns = [
        ...(draft.treasury ? ["Treasury is a target design (contract v3). This deploy won't include it."] : []),
        ...(current && "checks" in current && current.checks.policy === "inert" ? ["gno.land reviews new packages before they go live. Your DAO will wait for network approval after deploying."] : []),
        ...(current && "checks" in current && current.checks.replacesParked ? ["Replaces your earlier submission that gno.land has not enabled."] : []),
    ]

    const next = () => {
        if (step < 3) {
            const err = daoDraftError(draft, wallet, step)
            if (err) { setError(err); return }
        }
        if (!onReview) {
            setError(null)
            setStep(step + 1)
            return
        }
        const bad = firstInvalidStep(draft, wallet)
        if (bad !== null) { setStep(bad); setError(daoDraftError(draft, wallet, bad)); return }
        if (!ack) { setError("Confirm that you understand this deploys a permanent contract."); return }
        if (!current || !("checks" in current)) return
        let req
        try {
            req = createDaoRequest({
                wallet, config, checks: current.checks, price, lines: reviewLines, warns: reviewWarns,
                onSubmitted: (hash) => setOutcome({ kind: "submitted", hash }),
                onResult: (result, hash) => {
                    if (result.kind === "live") clearDaoDraft(GNO_CHAIN_ID, wallet)
                    setOutcome({ kind: "result", result, hash })
                },
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            return
        }
        signer.sign({ ...req, onSettled: (o) => { if (o === "unknown") setOutcome({ kind: "unknown" }) } })
    }

    let body
    if (step === 0) {
        body = (
            <div className="os-stack">
                <Field label="Name" htmlFor="os-dao-name" hint="3–64 characters." count={`${[...draft.name].length} / ${DAO_NAME_MAX}`}>
                    <input id="os-dao-name" className="os-in" value={draft.name} maxLength={DAO_NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Gno Builders" autoComplete="off" />
                </Field>
                <Field label="Description" htmlFor="os-dao-desc" hint="Optional. Up to 1,000 characters." count={`${draft.description.length} / ${DAO_DESCRIPTION_MAX}`}>
                    <textarea id="os-dao-desc" className="os-in os-ta" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What is this DAO for?" />
                </Field>
                <Field label="Starting point" hint="You can adjust the thresholds in step 3.">
                    <div className="os-opt" role="radiogroup" aria-label="Starting point">
                        {DAO_PRESETS.map((p) => (
                            <button key={p.id} type="button" role="radio" aria-checked={draft.preset === p.id} onClick={() => { setDraft((d) => applyPreset(d, p.id)); setError(null) }}>
                                <b>{p.name}</b>
                                <span className="os-sub">{p.threshold} % to pass{p.quorum ? ` · ${p.quorum} % quorum` : ""}</span>
                                <span className="os-sub">Votes last {formatSeconds(p.votingPeriodSeconds)}</span>
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="Address on gno.land" hint="Permanent. It can't be changed or reused.">
                    <div className="os-card os-mono os-break" data-testid="os-dao-path">{path}</div>
                </Field>
            </div>
        )
    } else if (step === 1) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Members · {draft.members.length} of max {DAO_REALM_LIMITS.maxMembers}</h3>
                <div className="os-mrow os-sub" aria-hidden="true"><span>Address</span><span>Power</span><span>Role</span><span /></div>
                {draft.members.map((m, i) => (
                    <div key={i} className="os-mrow">
                        <input className="os-in os-mono" value={m.address} onChange={(e) => setMember(i, { address: e.target.value })} placeholder="g1…" aria-label={`Member ${i + 1} address`} autoComplete="off" spellCheck={false} />
                        <input className="os-in" inputMode="numeric" value={m.powerText} onChange={(e) => setMember(i, { powerText: e.target.value })} aria-label={`Member ${i + 1} voting power`} />
                        <select className="os-in" value={m.role} onChange={(e) => setMember(i, { role: e.target.value })} aria-label={`Member ${i + 1} role`}>
                            {preset.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button type="button" className="os-xbtn" aria-label={`Remove member ${i + 1}`} disabled={draft.members.length < 2}
                            onClick={() => set({ members: draft.members.filter((_, j) => j !== i) })}>×</button>
                    </div>
                ))}
                <div className="os-row">
                    <button type="button" className="os-btn os-quiet" disabled={draft.members.length >= DAO_REALM_LIMITS.maxMembers}
                        onClick={() => set({ members: [...draft.members, { address: "", powerText: "1", role: preset.roles.includes("member") ? "member" : preset.roles[0] }] })}>+ Add member</button>
                    {!draft.members.some((m) => m.address.trim() === wallet) && (
                        <button type="button" className="os-btn os-quiet" onClick={() => set({ members: [...draft.members, { address: wallet, powerText: "1", role: preset.roles.includes("admin") ? "admin" : preset.roles[0] }] })}>+ Add me</button>
                    )}
                    <span className="os-grow" />
                    <span className="os-sub">Total voting power {total}</span>
                </div>
                {solo.length > 0 && config.members.length > 1 && <p className="os-note os-warn">{solo.map(shortAddr).join(", ")} can pass proposals alone.</p>}
                <p className="os-sub os-flush">Roles are labels; they grant no special powers.</p>
            </div>
        )
    } else if (step === 2) {
        body = (
            <div className="os-stack">
                <Field label="Threshold" htmlFor="os-dao-th" hint="Share of all voting power that must vote yes." count={`${draft.threshold} % yes`}>
                    <input id="os-dao-th" type="range" className="os-range" min={51} max={100} value={draft.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
                </Field>
                <Field label="Quorum" htmlFor="os-dao-q" hint="Share of all voting power that must vote. 0 means any turnout." count={`${draft.quorum} %`}>
                    <input id="os-dao-q" type="range" className="os-range" min={0} max={100} value={draft.quorum} onChange={(e) => set({ quorum: Number(e.target.value) })} />
                </Field>
                <Field label="Proposal categories" hint="Keep at least one.">
                    <div className="os-chipset">{categoryChoices(draft).map((c) => {
                        const on = draft.categories.includes(c)
                        return <button key={c} type="button" aria-pressed={on} disabled={on && draft.categories.length <= 1}
                            onClick={() => set({ categories: on ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] })}>{c}</button>
                    })}</div>
                </Field>
                <div className="os-card os-sub">From the {preset.name} preset: voting opens {formatSeconds(preset.executionDelaySeconds)} after a proposal passes, votes last {formatSeconds(preset.votingPeriodSeconds)}, and a passed proposal can be executed for {formatSeconds(preset.executionWindowSeconds)}.</div>
            </div>
        )
    } else if (step === 3) {
        body = (
            <div className="os-stack">
                <div className="os-card os-row os-dim">
                    <div className="os-grow"><b>Channels</b><div className="os-sub">Discussion channels for members.</div></div>
                    <span className="os-pill">Not on {GNO_CHAIN_ID} yet</span>
                </div>
                <div className="os-card os-row">
                    <div className="os-grow">
                        <span className="os-tgt">Target · contract v3</span>
                        <div><b>Treasury</b></div>
                        <div className="os-sub">Let the DAO hold GNOT and tokens, and spend them by proposal.</div>
                    </div>
                    <button type="button" className={`os-btn${draft.treasury ? "" : " os-quiet"}`} aria-pressed={draft.treasury} onClick={() => set({ treasury: !draft.treasury })}>{draft.treasury ? "On" : "Off"}</button>
                </div>
            </div>
        )
    } else {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Review</h3>
                <div className="os-rv-title">Deploy “{draft.name.trim()}”</div>
                <div className="os-sub">{config.members.length} member{config.members.length === 1 ? "" : "s"} · {preset.name} rules</div>
                <dl className="os-kv">{reviewLines.map(([k, v]) => <div key={k} className="os-kv-row"><dt>{k}</dt><dd className={k === "Address" ? "os-mono os-break" : undefined}>{v}</dd></div>)}</dl>
                {reviewWarns.map((w) => <p key={w} className="os-note os-warn">{w}</p>)}
                {!current && <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Checking the address on {GNO_CHAIN_ID}…</span></div>}
                {current && "checks" in current && <p className="os-note os-ok" data-testid="os-dao-checks">✓ You can publish under this address · ✓ The address is {current.checks.replacesParked ? "yours to replace" : "free"}</p>}
                {current && "error" in current && (
                    <p className="os-note os-err" role="alert">{current.error} <button type="button" className="os-btn os-quiet os-inline" onClick={() => setCheckRev((r) => r + 1)}>Check again</button></p>
                )}
                <p className="os-sub os-flush">Roles are labels; they grant no special powers. The code and the address are permanent once deployed.</p>
                <label className="os-ack"><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setError(null) }} /> I understand this deploys a permanent contract on {GNO_CHAIN_ID}.</label>
                {inFlight && <p className="os-note" role="status">A deploy to this address is still waiting for Adena.</p>}
            </div>
        )
    }

    return (
        <WizardFrame steps={DAO_STEPS} step={step} onBack={() => { setError(null); setStep(step - 1) }} onNext={next}
            nextLabel={onReview ? "Deploy with Adena…" : "Continue"}
            nextDisabled={onReview && (!current || !("checks" in current) || inFlight)}
            note={error ? <span className="os-fe" role="alert">{error}</span> : "Your draft is saved in this browser."}
            preview={(
                <div className="os-stack os-tight">
                    <h3 className="os-h os-flush">Your DAO</h3>
                    <div className="os-pvcard os-center">
                        <ThingTile icon="folder" tint={DAO_TINT} size={56} />
                        <b>{draft.name.trim() || <span className="os-sub">Name</span>}</b>
                        <span className="os-sub os-mono os-break">{path}</span>
                    </div>
                    <dl className="os-kv">
                        <div className="os-kv-row"><dt>Members</dt><dd>{config.members.length}</dd></div>
                        <div className="os-kv-row"><dt>Voting power</dt><dd>{total}</dd></div>
                        <div className="os-kv-row"><dt>Passes with</dt><dd>{draft.threshold} % yes</dd></div>
                        <div className="os-kv-row"><dt>Quorum</dt><dd>{draft.quorum} %</dd></div>
                        <div className="os-kv-row"><dt>Votes last</dt><dd>{formatSeconds(preset.votingPeriodSeconds)}</dd></div>
                        {draft.treasury && <div className="os-kv-row"><dt>Treasury</dt><dd><span className="os-tgt">target</span></dd></div>}
                    </dl>
                </div>
            )}>
            {body}
        </WizardFrame>
    )
}

/**
 * A submission saved for this address (by this wizard or the classic page):
 * check its status, and only when the chain shows no package (or a parked one
 * this wallet may replace) offer another attempt, as the classic page does.
 */
function SavedSubmission({ wallet, path, name, txHash, orgId, inFlight, unknown, onLive, onReleased }: {
    wallet: string; path: string; name: string; txHash: string; orgId: string | null; inFlight: boolean; unknown: boolean
    onLive: () => void; onReleased: () => void
}) {
    const [status, setStatus] = useState<{ kind: "unknown" | "inert" | "absent"; reason: string; canRepair: boolean }>({
        kind: "unknown", canRepair: false,
        reason: unknown ? "Memba couldn't confirm the result. The DAO may exist." : "A previous submission attempt is saved. Check the network before trying again.",
    })
    const [busy, setBusy] = useState(false)
    const [ack, setAck] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const check = async () => {
        setBusy(true)
        setError(null)
        try {
            const outcome = await waitForPackage(deployChain(), path, { timeoutMs: 0 })
            if (outcome.outcome === "live") {
                saveDAOForRecovery(orgId, path, name)
                removePendingDAO(GNO_CHAIN_ID, path)
                onLive()
                return
            }
            setAck(false)
            setStatus(outcome.outcome === "failed"
                ? { kind: "absent", reason: outcome.error, canRepair: false }
                : { kind: outcome.unconfirmed ? "unknown" : "inert", reason: outcome.meta?.reason ?? "Status could not be confirmed", canRepair: !outcome.unconfirmed && outcome.meta?.creator === wallet })
        } catch {
            setError("Could not save the recovered DAO. Its submission record is kept; check again.")
        } finally {
            setBusy(false)
        }
    }
    const release = async () => {
        if (inFlight) return
        setBusy(true)
        setError(null)
        try {
            // Re-validate right before releasing the saved attempt.
            await assertCanDeployTo(deployChain(), wallet, path)
            await assertPathAvailable(deployChain(), path, wallet)
            if (isSubmissionActive(submissionKey(GNO_CHAIN_ID, path))) throw new Error("This submission is still in progress")
            removePendingDAO(GNO_CHAIN_ID, path)
            onReleased()
        } catch (err) {
            setError(friendlyError(err))
        } finally {
            setBusy(false)
        }
    }
    const title = status.kind === "inert" ? "Submitted, not enabled yet" : status.kind === "absent" ? "Package not found" : "Outcome unknown"
    return (
        <Gate>
            <b>{title}</b>
            <span className="os-sub">
                {status.kind === "inert" ? "The package is stored but not enabled. It becomes usable once the network enables it."
                    : status.kind === "absent" ? "The network has no package at this address. Check the transaction before trying again."
                        : "The last attempt may have gone through. Check the address before deploying again."}
            </span>
            <span className="os-sub">Network status: {status.reason}</span>
            <code className="os-mono os-break os-sub">{path}{txHash ? ` · Transaction ${txHash}` : " · No transaction hash was returned"}</code>
            {inFlight && <span className="os-note" role="status">A wallet request is still in progress. Finish it first.</span>}
            <button type="button" className="os-btn os-quiet" disabled={busy || inFlight} onClick={() => { void check() }}>Check status</button>
            {(status.kind === "absent" || status.canRepair) && (
                <>
                    <span className="os-sub">{status.canRepair ? "This wallet owns the parked package. You can review a replacement; it needs a new signature and deposit." : "Only continue after checking the transaction in your wallet or an explorer."}</span>
                    <label className="os-ack"><input type="checkbox" checked={ack} disabled={inFlight} onChange={(e) => setAck(e.target.checked)} /> I checked the previous transaction and want to review a new deploy.</label>
                    <button type="button" className="os-btn" disabled={busy || inFlight || !ack} onClick={() => { void release() }}>Review another attempt</button>
                </>
            )}
            {error && <span className="os-note os-err" role="alert">{error}</span>}
        </Gate>
    )
}

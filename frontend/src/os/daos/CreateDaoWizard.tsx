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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react"
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
    adoptGuestDraft, applyPreset, categoryChoices, clearDaoDraft, DAO_STEPS, daoConfig, daoDraftError, emptyDaoDraft, firstInvalidStep,
    formatSeconds, GUEST_SEAT, presetById, readDaoDraft, realmPathFor, saveDaoDraft, slugForName, soloMembers, totalPower, userDaoCapabilities, withGuestSeat, type DaoDraft,
} from "./createDao"
import { balanceShortfall, createDaoRequest, deployChain, deployCosts, depositLeaves, MISSING_NOTE, PARKED_NOTE, runDeployChecks, type DeployChecks, type DeployResult } from "./createDaoRequest"
import { nameForRealm } from "./daoNames"

const DAO_TINT = ["#2FC08E", "#12A07A"] as const

function Gate({ children }: { children: ReactNode }) {
    return <div className="os-holding"><ThingTile icon="folder" tint={DAO_TINT} size={44} /><div className="os-stack os-tight">{children}</div></div>
}

/** A guest's draft and step, carried to the wizard of the wallet they connect. */
type GuestWork = { draft: DaoDraft; step: number } | null

export function CreateDaoWizard({ session, open, close }: { session: OsSession; open: (spec: WindowSpec) => void; close: () => void }) {
    const [guestWork, setGuestWork] = useState<GuestWork>(null)
    const caps = userDaoCapabilities()
    if (!caps.create) return <Gate><b>Creating a DAO is not available on {caps.label} yet.</b></Gate>
    if (session.status === "resuming") return <Gate><b>Reading your wallet…</b></Gate>
    // Guests fill every step in; the wallet is asked for at Deploy. Keyed by network and
    // wallet: a stored draft and a saved submission belong to one wallet.
    const wallet = session.status === "member" ? session.address : null
    return <Wizard key={`${GNO_CHAIN_ID}:${wallet ?? ""}`} wallet={wallet} carried={guestWork} onGuestWork={setGuestWork} onConnect={session.openConnect} open={open} close={close} />
}

type Outcome =
    | { kind: "submitted"; hash: string }
    | { kind: "result"; result: DeployResult; hash: string }
    | { kind: "unknown" }

type Checked = { key: string; checks: DeployChecks } | { key: string; error: string }

function Wizard({ wallet, carried, onGuestWork, onConnect, open, close }: {
    wallet: string | null; carried: GuestWork; onGuestWork: (work: GuestWork) => void; onConnect: () => void; open: (spec: WindowSpec) => void; close: () => void
}) {
    const signer = useSigner()
    const [draft, setDraft] = useState<DaoDraft>(() => {
        if (!wallet) return carried?.draft ?? emptyDaoDraft(null)
        // What a guest filled in stays on screen when they connect.
        return carried ? adoptGuestDraft(carried.draft, wallet) : readDaoDraft(GNO_CHAIN_ID, wallet) ?? emptyDaoDraft(wallet)
    })
    // A wallet's own saved draft is never replaced unasked: until the choice, nothing is saved.
    const [savedDraft, setSavedDraft] = useState<DaoDraft | null>(() => {
        const stored = wallet && carried ? readDaoDraft(GNO_CHAIN_ID, wallet) : null
        return stored && wallet && carried && JSON.stringify(stored) !== JSON.stringify(adoptGuestDraft(carried.draft, wallet)) ? stored : null
    })
    // A submission saved for the draft's address opens on the Review step, where it's checked.
    const [step, setStep] = useState(() => carried?.step
        ?? (wallet && listPendingDAOs(GNO_CHAIN_ID).some((p) => p.path === realmPathFor(wallet, draft.name)) ? DAO_STEPS.length - 1 : 0))
    const [error, setError] = useState<string | null>(null)
    const [ack, setAck] = useState(false)
    // Null until read: the review's fee is handed to the wallet as shown, so Deploy waits for it.
    const [price, setPrice] = useState<GasPrice | null>(null)
    const [checked, setChecked] = useState<Checked | null>(null)
    const [checkRev, setCheckRev] = useState(0)
    const [outcome, setOutcome] = useState<Outcome | null>(null)
    const [draftSaved, setDraftSaved] = useState(true)
    const [draftClearWarning, setDraftClearWarning] = useState(false)
    const skipSave = useRef(false)
    const [, rerender] = useState(0)

    // A guest's empty first row stands for their wallet until they connect.
    const seat = wallet ?? GUEST_SEAT
    const effective = useMemo(() => (wallet ? draft : withGuestSeat(draft)), [draft, wallet])
    const path = realmPathFor(seat, draft.name)
    const shownPath = wallet ? path : `gno.land/r/‹your address›/${slugForName(draft.name)}`
    const who = (address: string) => (!wallet && address === GUEST_SEAT ? "you" : shortAddr(address))
    const preset = presetById(draft.preset)
    const config = useMemo(() => daoConfig(effective, seat), [effective, seat])
    const onReview = step === DAO_STEPS.length - 1
    const checkKey = `${path}|${checkRev}`
    const current = checked?.key === checkKey ? checked : null

    // The automatic draft (D18), kept for a wallet; a guest's lives on this page until they connect. A finished deploy clears it.
    useEffect(() => {
        if (!wallet) {
            const touched = step > 0 || JSON.stringify(draft) !== JSON.stringify(emptyDaoDraft(null))
            onGuestWork(touched ? { draft, step } : null)
            return
        }
        if (savedDraft) return
        if (outcome || skipSave.current) { skipSave.current = false; return }
        setDraftSaved(saveDaoDraft(GNO_CHAIN_ID, wallet, draft))
    }, [wallet, draft, step, outcome, onGuestWork, savedDraft])
    // Taken over by the wallet: a later disconnect starts a fresh guest draft.
    useEffect(() => { if (wallet) onGuestWork(null) }, [wallet, onGuestWork])

    useEffect(() => {
        let active = true
        networkGasPrice().then((p) => { if (active) setPrice(p) }, () => { if (active) setPrice(FALLBACK_GAS_PRICE) })
        return () => { active = false }
    }, [])

    // The chain checks run as the Review step opens (mockup: "✓ You can publish under this address · ✓ The address is free").
    useEffect(() => {
        if (!onReview || !wallet) return
        let active = true
        runDeployChecks(wallet, path).then(
            (checks) => { if (active) setChecked({ key: checkKey, checks }) },
            (err: unknown) => { if (active) setChecked({ key: checkKey, error: friendlyError(err) }) },
        )
        return () => { active = false }
    }, [onReview, wallet, path, checkKey])

    const activity = submissionKey(GNO_CHAIN_ID, path)
    const inFlight = useSyncExternalStore(subscribeSubmissions, () => isSubmissionActive(activity))
    const saved = wallet ? listPendingDAOs(GNO_CHAIN_ID).find((p) => p.path === path && (!p.wallet || p.wallet === wallet)) : undefined

    const set = (patch: Partial<DaoDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }
    const setMember = (i: number, patch: Partial<DaoDraft["members"][number]>) => set({ members: draft.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
    const discardDraft = () => {
        if (wallet && !clearDaoDraft(GNO_CHAIN_ID, wallet)) { setError("Browser storage refused to remove the saved draft. Try again or clear this site's storage in your browser."); return }
        skipSave.current = true
        setDraft(emptyDaoDraft(wallet))
        setStep(0)
        setError(null)
        setAck(false)
        setChecked(null)
        setCheckRev((rev) => rev + 1)
        setDraftSaved(true)
    }
    const clearCompletedDraft = () => setDraftClearWarning(!!wallet && !clearDaoDraft(GNO_CHAIN_ID, wallet))
    const onPresetKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? DAO_PRESETS.length - 1
            : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % DAO_PRESETS.length
                : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + DAO_PRESETS.length - 1) % DAO_PRESETS.length : -1
        if (next < 0) return
        event.preventDefault()
        setDraft((d) => applyPreset(d, DAO_PRESETS[next].id))
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
    }
    const openDao = () => {
        const name = nameForRealm(path)
        close()
        if (name) open(daoSpec(name))
    }

    const policy = current && "checks" in current ? current.checks.policy : "unknown"
    const costs = deployCosts(config, policy, price ?? FALLBACK_GAS_PRICE)
    const short = current && "checks" in current && price ? balanceShortfall(current.checks.balanceUgnot, costs, policy) : null

    // ── After the wallet returned: the deploy's status, as the classic pipeline ──
    if (outcome && outcome.kind !== "unknown") {
        const hash = outcome.hash
        const res = outcome.kind === "result" ? outcome.result : null
        // Waiting for approval only once the chain shows the package parked.
        const parked = res?.kind === "pending" && !res.unconfirmed
        const title = !res ? "Submitted · checking the network"
            : res.kind === "live" ? "Your DAO is live"
                : res.kind === "pending" ? (res.unconfirmed ? "Submitted · status unknown" : "Submitted · waiting for network approval")
                    : res.kind === "refused" ? "Refused by the network" : "Submitted · not on chain yet"
        return (
            <div className="os-stack" role="status" aria-live="polite">
                <div className="os-row">{!res && <span className="os-spin" aria-hidden="true" />}<h3 className="os-rv-title">{title}</h3></div>
                <ol className="os-pipe">
                    <li className="os-done">Checked the address</li>
                    <li className="os-done">Signed in Adena</li>
                    <li className={res?.kind === "live" ? "os-done" : "os-cur"}>{res?.kind === "live" ? "Package live" : res?.kind === "refused" ? "Refused by the network" : parked ? "Waiting for network approval" : "Checking the network"}</li>
                </ol>
                {res?.kind === "live" && <p className="os-note os-ok">Members can make proposals right away.</p>}
                {draftClearWarning && <p className="os-note os-warn">Your DAO is live, but browser storage kept its old draft. <button type="button" className="os-btn os-quiet os-inline" onClick={clearCompletedDraft}>Remove saved draft</button></p>}
                {parked && <p className="os-note os-warn">{PARKED_NOTE} The storage deposit (about {formatGnot(costs.estimateUgnot)}) leaves your balance {depositLeaves("inert")}: keep it in this wallet until then.</p>}
                {res?.kind === "pending" && res.unconfirmed && <p className="os-note os-warn">The package status couldn't be read yet. This doesn't mean it failed. Check again before deploying anything else to this address.</p>}
                {res?.kind === "refused" && <p className="os-note os-err">The network ran this deploy and refused it. Nothing was deployed; the network fee was still charged. Check the transaction before trying again.</p>}
                {res?.kind === "missing" && <p className="os-note os-warn">{MISSING_NOTE}</p>}
                <code className="os-mono os-break os-sub">{path}{hash ? ` · Transaction ${hash}` : ""}</code>
                <div className="os-row os-end">
                    {res?.kind === "live" ? <button type="button" className="os-btn" onClick={openDao}>Open DAO</button>
                        : res ? <button type="button" className="os-btn os-quiet" onClick={() => { setOutcome(null); rerender((x) => x + 1) }}>Check status</button> : null}
                </div>
            </div>
        )
    }

    // ── A saved submission for this address locks the deploy until it is checked ──
    if (saved && onReview && wallet) {
        return <SavedSubmission wallet={wallet} path={path} name={draft.name} txHash={saved.txHash} orgId={saved.orgId ?? null} inFlight={inFlight}
            unknown={outcome?.kind === "unknown"}
            onLive={() => { clearCompletedDraft(); setOutcome({ kind: "result", result: { kind: "live" }, hash: saved.txHash }) }}
            onReleased={() => { setOutcome(null); setAck(false); setCheckRev((r) => r + 1) }} />
    }

    const solo = soloMembers(effective)
    const total = totalPower(effective)
    const reviewLines: [string, string][] = [
        ["Address", shownPath],
        ["Rules", `${draft.threshold} % yes${draft.quorum ? `, ${draft.quorum} % quorum` : ""} · votes last ${formatSeconds(preset.votingPeriodSeconds)}`],
        ["Members", config.members.map((m) => `${who(m.address)} (${m.power}, ${m.roles.join(", ")})`).join(" · ")],
        ["Storage deposit", `≈ ${formatGnot(costs.estimateUgnot)} (cap ${formatGnot(costs.capUgnot)}), taken from your balance ${depositLeaves(policy)}`],
        ["Network fee", !price ? "reading the network price…"
            // Not a read: say so while it is on screen. The price is read again before the wallet opens.
            : price === FALLBACK_GAS_PRICE ? `about ${formatGnot(costs.feeUgnot)} (estimate: the network price could not be read; it is read again before signing)`
                // Before the checks, the gas is sized for the larger of the two submission policies.
                : !wallet ? `up to ${formatGnot(costs.feeUgnot)} (priced again once you connect)`
                    : formatGnot(costs.feeUgnot)],
        ...(current && "checks" in current ? [["Your balance", formatGnot(Number(current.checks.balanceUgnot))] as [string, string]] : []),
        ["Network", GNO_CHAIN_ID],
    ]
    const reviewWarns = [
        ...(draft.treasury ? ["Treasury is a target design (contract v3). This deploy won't include it."] : []),
        ...(current && "checks" in current && current.checks.policy === "inert" ? ["gno.land reviews new packages before they go live. Your DAO will wait for network approval after deploying."] : []),
        ...(current && "checks" in current && current.checks.replacesParked ? ["Replaces your earlier submission that gno.land has not enabled."] : []),
    ]

    const next = () => {
        if (step < 3) {
            const err = daoDraftError(effective, seat, step)
            if (err) { setError(err); return }
        }
        if (!onReview) {
            setError(null)
            setStep(step + 1)
            return
        }
        const bad = firstInvalidStep(effective, seat)
        if (bad !== null) { setStep(bad); setError(daoDraftError(effective, seat, bad)); return }
        // A guest's draft is complete: the wallet is what's missing.
        if (!wallet) { onConnect(); return }
        if (!ack) { setError("Confirm that you understand this deploys a permanent contract."); return }
        if (!current || !("checks" in current) || !price) return
        if (short) { setError(short); return }
        let req
        try {
            req = createDaoRequest({
                wallet, config, checks: current.checks, price, lines: reviewLines, warns: reviewWarns,
                onRisenPrice: setPrice,
                onSubmitted: (hash) => setOutcome({ kind: "submitted", hash }),
                onResult: (result, hash) => {
                    if (result.kind === "live") clearCompletedDraft()
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
                <Field label="Name" htmlFor="os-dao-name" hint="3–64 characters. The address below uses its Latin letters a–z and digits." count={`${draft.name.length} / ${DAO_NAME_MAX}`}>
                    <input id="os-dao-name" className="os-in" value={draft.name} maxLength={DAO_NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Gno Builders" autoComplete="off" />
                </Field>
                <Field label="Description" htmlFor="os-dao-desc" hint="Optional. Up to 1,000 characters." count={`${draft.description.length} / ${DAO_DESCRIPTION_MAX}`}>
                    <textarea id="os-dao-desc" className="os-in os-ta" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What is this DAO for?" />
                </Field>
                <Field label="Starting point" hint="You can adjust the thresholds in step 3.">
                    <div className="os-opt" role="radiogroup" aria-label="Starting point">
                        {DAO_PRESETS.map((p, index) => (
                            <button key={p.id} type="button" role="radio" aria-checked={draft.preset === p.id} tabIndex={draft.preset === p.id ? 0 : -1}
                                onKeyDown={(event) => onPresetKey(event, index)} onClick={() => { setDraft((d) => applyPreset(d, p.id)); setError(null) }}>
                                <b>{p.name}</b>
                                <span className="os-sub">{p.threshold} % to pass{p.quorum ? ` · ${p.quorum} % quorum` : ""}</span>
                                <span className="os-sub">Votes last {formatSeconds(p.votingPeriodSeconds)}</span>
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="Address on gno.land" hint="Permanent. It can't be changed or reused.">
                    <div className="os-card os-mono os-break" data-testid="os-dao-path">{shownPath}</div>
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
                        <input className="os-in os-mono" value={m.address} onChange={(e) => setMember(i, { address: e.target.value })} placeholder={!wallet && i === 0 ? "Your address, when you connect" : "g1…"} aria-label={`Member ${i + 1} address`} autoComplete="off" spellCheck={false} />
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
                    {wallet && !draft.members.some((m) => m.address.trim() === wallet) && (
                        <button type="button" className="os-btn os-quiet" onClick={() => set({ members: [...draft.members, { address: wallet, powerText: "1", role: preset.roles.includes("admin") ? "admin" : preset.roles[0] }] })}>+ Add me</button>
                    )}
                    <span className="os-grow" />
                    <span className="os-sub">Total voting power {total}</span>
                </div>
                {solo.length > 0 && config.members.length > 1 && <p className="os-note os-warn">{solo.map(who).join(", ")} can pass proposals alone.</p>}
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
                <div className="os-card os-sub">From the {preset.name} preset: votes last {formatSeconds(preset.votingPeriodSeconds)}, and a passed proposal can be executed from {formatSeconds(preset.executionDelaySeconds)} after it passes, for {formatSeconds(preset.executionWindowSeconds)}.</div>
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
                {!wallet && <p className="os-note" role="status">Connect a wallet to deploy. The address is made from your wallet's address, and Memba checks it and your balance before you sign.</p>}
                {wallet && !current && <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Checking the address on {GNO_CHAIN_ID}…</span></div>}
                {current && "checks" in current && <p className="os-note os-ok" data-testid="os-dao-checks">✓ You can publish under this address · ✓ The address is {current.checks.replacesParked ? "yours to replace" : "free"}</p>}
                {short && <p className="os-note os-err" role="alert">{short} <button type="button" className="os-btn os-quiet os-inline" onClick={() => setCheckRev((r) => r + 1)}>Check again</button></p>}
                {current && "error" in current && (
                    <p className="os-note os-err" role="alert">{current.error} <button type="button" className="os-btn os-quiet os-inline" onClick={() => setCheckRev((r) => r + 1)}>Check again</button></p>
                )}
                <p className="os-sub os-flush">Roles are labels; they grant no special powers. The code and the address are permanent once deployed.</p>
                {wallet && <label className="os-ack"><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setError(null) }} /> I understand this deploys a permanent contract on {GNO_CHAIN_ID}.</label>}
                {inFlight && <p className="os-note" role="status">A deploy to this address is still waiting for Adena.</p>}
            </div>
        )
    }

    const choice = savedDraft && (
        <div className="os-note os-warn" role="status">
            <span>This wallet already has a saved draft{savedDraft.name.trim() ? ` (“${savedDraft.name.trim()}”)` : ""}. Keep what you filled in, which replaces it, or open the saved one.</span>
            <div className="os-row">
                <button type="button" className="os-btn os-quiet os-inline" onClick={() => setSavedDraft(null)}>Keep what I filled in</button>
                <button type="button" className="os-btn os-quiet os-inline" onClick={() => { setDraft(savedDraft); setStep(0); setError(null); setSavedDraft(null) }}>Open the saved draft</button>
            </div>
        </div>
    )

    return (
        <WizardFrame steps={DAO_STEPS} step={step} onBack={() => { setError(null); setStep(step - 1) }} onNext={next}
            nextLabel={onReview ? (wallet ? "Deploy with Adena…" : "Connect a wallet to deploy") : "Continue"}
            nextDisabled={onReview && !!wallet && (!current || !("checks" in current) || inFlight || !price || short !== null)}
            note={<>{error && <span className="os-fe" role="alert">{error}</span>}<span>{!wallet ? "This draft lasts while this page stays open, and is kept in this browser once you connect." : draftSaved ? "Your draft is saved in this browser." : "Browser storage is unavailable. This draft lasts only while this page stays open."}</span>{(draftSaved || !wallet) && <button type="button" className="os-btn os-quiet os-inline" onClick={discardDraft}>Discard draft</button>}</>}
            preview={(
                <div className="os-stack os-tight">
                    <h3 className="os-h os-flush">Your DAO</h3>
                    <div className="os-pvcard os-center">
                        <ThingTile icon="folder" tint={DAO_TINT} size={56} />
                        <b>{draft.name.trim() || <span className="os-sub">Name</span>}</b>
                        <span className="os-sub os-mono os-break">{shownPath}</span>
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
            {choice}{body}
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
    const title = status.kind === "inert" ? "Submitted · waiting for network approval" : status.kind === "absent" ? "Not on chain yet" : "Outcome unknown"
    return (
        <Gate>
            <b>{title}</b>
            <span className="os-sub">
                {status.kind === "inert" ? PARKED_NOTE
                    : status.kind === "absent" ? MISSING_NOTE
                        : "The last attempt may have gone through. Check the address before deploying again."}
            </span>
            <span className="os-sub">Network status: {status.reason}</span>
            <code className="os-mono os-break os-sub">{path}{txHash ? ` · Transaction ${txHash}` : " · No transaction hash was returned"}</code>
            {inFlight && <span className="os-note" role="status">A wallet request is still in progress. Finish it first.</span>}
            <button type="button" className="os-btn os-quiet" disabled={busy || inFlight} onClick={() => { void check() }}>Check status</button>
            {(status.kind === "absent" || status.canRepair) && (
                <>
                    <span className="os-sub">{status.canRepair ? "This wallet owns the parked package. You can review a replacement: it needs a new signature and network fee." : "Only continue after checking the transaction in your wallet or an explorer."}</span>
                    <label className="os-ack"><input type="checkbox" checked={ack} disabled={inFlight} onChange={(e) => setAck(e.target.checked)} /> I checked the previous transaction and want to review a new deploy.</label>
                    <button type="button" className="os-btn" disabled={busy || inFlight || !ack} onClick={() => { void release() }}>Review another attempt</button>
                </>
            )}
            {error && <span className="os-note os-err" role="alert">{error}</span>}
        </Gate>
    )
}

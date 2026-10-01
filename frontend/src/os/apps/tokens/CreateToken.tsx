/**
 * The wizard that creates a direct Launchpad token: the token, its
 * distribution, an optional airdrop, and a review that reads the live launch
 * terms and signs. Guests fill it in; connecting is asked for only to sign.
 *
 * @module os/apps/tokens/CreateToken
 */
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID } from "../../../lib/config"
import { formatUgnotExact } from "../../../lib/dao/v2Budget"
import { formatTokenAmount as units, networkGasPriceFresh } from "../../../lib/grc20"
import { prepareAirdropManifest, type AirdropEntry, type AirdropManifest } from "../../../lib/tokenLaunchpadAirdropManifest"
import { TokenLaunchpadClient } from "../../../lib/tokenLaunchpadClient"
import { readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import { TokenLaunchpadSalesClient } from "../../../lib/tokenLaunchpadSalesClient"
import { Segmented, Loading, ErrorState } from "../../kit"
import { useSigner } from "../../sign/signerContext"
import type { OsSession } from "../../shell/useOsSession"
import { Field, WizardFrame } from "../../wizard/WizardFrame"
import { createDirectRequest, creatorShare, directLaunchProblem, LAUNCH_CURRENCY, parseAirdrop, toBaseUnits, type DirectLaunch, type LaunchPart, type LaunchProblem } from "./createDirect"

const STEPS = ["Token", "Distribution", "Airdrop", "Review"] as const
const STEP_OF: Record<LaunchPart, number> = { token: 0, distribution: 1, airdrop: 2 }

interface Row { address: string; amount: string; vesting: string; cliff: string }
interface Draft { mode: DirectLaunch["mode"]; name: string; ticker: string; decimals: string; supply: string; max: string; description: string; rows: Row[]; airdrop: string }

const EMPTY: Draft = { mode: "direct_fixed", name: "", ticker: "", decimals: "6", supply: "", max: "", description: "", rows: [], airdrop: "" }

type Built = { launch: DirectLaunch; entries: AirdropEntry[] } | { problem: LaunchProblem }

function build(d: Draft): Built {
    const decimals = Number(d.decimals)
    const token = (message: string) => ({ problem: { part: "token" as const, message } })
    if (!/^\d{1,2}$/.test(d.decimals) || decimals > 12) return token("Decimals must be 0 to 12.")
    const supply = toBaseUnits(d.supply, decimals)
    if (supply === null) return token("Enter the initial supply as a number of tokens.")
    const max = d.mode === "direct_capped" ? toBaseUnits(d.max, decimals) : supply
    if (max === null) return token("Enter the maximum supply as a number of tokens.")
    const allocations = []
    for (const [i, r] of d.rows.entries()) {
        const amount = toBaseUnits(r.amount, decimals)
        if (amount === null || !/^\d+$/.test(r.vesting) || !/^\d+$/.test(r.cliff)) return { problem: { part: "distribution", message: `Allocation ${i + 1} needs an amount and whole days.` } }
        allocations.push({ beneficiary: r.address.trim(), amount, vestingDays: Number(r.vesting), cliffDays: Number(r.cliff) })
    }
    const entries = parseAirdrop(d.airdrop, decimals)
    if (typeof entries === "string") return { problem: { part: "airdrop", message: entries } }
    const launch: DirectLaunch = {
        mode: d.mode, name: d.name, ticker: d.ticker, decimals, initialSupply: supply, maxSupply: max, description: d.description,
        allocations, airdropTotal: entries.reduce((sum, e) => sum + BigInt(e.amount), 0n),
    }
    const problem = directLaunchProblem(launch)
    return problem ? { problem } : { launch, entries }
}

export default function CreateToken({ network, session, onClose, onCreated }: { network: string; session: OsSession; onClose: () => void; onCreated: () => void }) {
    const [draft, setDraft] = useState<Draft>(EMPTY)
    const [step, setStep] = useState(0)
    const [error, setError] = useState<string | null>(null)
    // The outcome of the last signature and the airdrop manifest it committed to.
    const [outcome, setOutcome] = useState<{ kind: string; manifest: AirdropManifest | null } | null>(null)
    const [savedAfter, setSavedAfter] = useState<string | null>(null)
    const signer = useSigner()
    const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setError(null) }
    const setRow = (i: number, patch: Partial<Row>) => set({ rows: draft.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
    const built = useMemo(() => build(draft), [draft])
    const decimals = Number(draft.decimals) || 0

    const next = () => {
        // Continue stops at the step whose fields break a rule; later steps' problems wait.
        if ("problem" in built && STEP_OF[built.problem.part] <= step) { setError(built.problem.message); return }
        setStep(step + 1)
    }

    let body
    if (outcome?.kind === "confirmed" || outcome?.kind === "submitted") {
        const manifest = outcome.manifest
        return (
            <div className="os-stack">
                <p className="os-note os-ok" role="status">{outcome.kind === "confirmed"
                    ? `${draft.name} (${draft.ticker}) is created${manifest ? ` as ${manifest.tokenId}` : ""}.`
                    : `The creation was sent; ${draft.ticker} appears in the list once the network includes it.`}</p>
                {manifest && <ManifestSaver manifest={manifest} amount={`${units(BigInt(manifest.total), decimals)} ${draft.ticker}`} saved={savedAfter} onSaved={setSavedAfter} />}
                <div className="os-row"><button type="button" className="os-btn" onClick={() => { onCreated(); onClose() }}>Back to tokens</button></div>
            </div>
        )
    }
    if (step === 0) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Token</h3>
                <Segmented label="Supply" value={draft.mode} onChange={mode => set({ mode })}
                    options={[{ id: "direct_fixed", name: "Fixed supply" }, { id: "direct_capped", name: "Capped supply" }]} />
                <Field label="Name" htmlFor="os-tok-name" hint="1 to 32 characters.">
                    <input id="os-tok-name" className="os-in" value={draft.name} onChange={e => set({ name: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Ticker" htmlFor="os-tok-ticker" hint="1 to 10 capital letters or digits.">
                    <input id="os-tok-ticker" className="os-in os-mono" value={draft.ticker} onChange={e => set({ ticker: e.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="Decimals" htmlFor="os-tok-dec" hint="How finely a token divides; 6 like GNOT.">
                    <input id="os-tok-dec" className="os-in" inputMode="numeric" value={draft.decimals} onChange={e => set({ decimals: e.target.value })} />
                </Field>
                <Field label="Initial supply" htmlFor="os-tok-supply" hint="Tokens minted at creation.">
                    <input id="os-tok-supply" className="os-in" inputMode="decimal" value={draft.supply} onChange={e => set({ supply: e.target.value })} />
                </Field>
                {draft.mode === "direct_capped" && <Field label="Maximum supply" htmlFor="os-tok-max" hint="You can mint up to this later, to recorded allocations only.">
                    <input id="os-tok-max" className="os-in" inputMode="decimal" value={draft.max} onChange={e => set({ max: e.target.value })} />
                </Field>}
                <Field label="Description" htmlFor="os-tok-desc" hint="Optional, at most 280 bytes.">
                    <textarea id="os-tok-desc" className="os-in os-ta" value={draft.description} onChange={e => set({ description: e.target.value })} />
                </Field>
            </div>
        )
    } else if (step === 1) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Distribution</h3>
                <p className="os-sub os-flush">Each allocation is paid at creation, or vested to its address over a number of days. What is left goes to you.</p>
                {draft.rows.map((r, i) => (
                    <div key={i} className="os-tokens-arow">
                        <input className="os-in os-mono" value={r.address} onChange={e => setRow(i, { address: e.target.value })} placeholder="g1…" aria-label={`Allocation ${i + 1} address`} autoComplete="off" spellCheck={false} />
                        <input className="os-in" inputMode="decimal" value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} aria-label={`Allocation ${i + 1} amount`} />
                        <input className="os-in" inputMode="numeric" value={r.vesting} onChange={e => setRow(i, { vesting: e.target.value })} aria-label={`Allocation ${i + 1} vesting days`} />
                        <input className="os-in" inputMode="numeric" value={r.cliff} onChange={e => setRow(i, { cliff: e.target.value })} aria-label={`Allocation ${i + 1} cliff days`} />
                        <button type="button" className="os-xbtn" aria-label={`Remove allocation ${i + 1}`} onClick={() => set({ rows: draft.rows.filter((_, j) => j !== i) })}>×</button>
                    </div>
                ))}
                <div className="os-row">
                    <button type="button" className="os-btn os-quiet" disabled={draft.rows.length >= 50} onClick={() => set({ rows: [...draft.rows, { address: "", amount: "", vesting: "0", cliff: "0" }] })}>+ Add allocation</button>
                    <span className="os-grow" />
                    {"launch" in built && <span className="os-sub">To you: {units(creatorShare(built.launch), decimals)} {draft.ticker}</span>}
                </div>
            </div>
        )
    } else if (step === 2) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Airdrop</h3>
                <Field label="Recipients" htmlFor="os-tok-air" hint="Optional. One line each: an address and an amount of tokens. Each recipient claims with a proof from the manifest you get at review.">
                    <textarea id="os-tok-air" className="os-in os-ta os-mono" value={draft.airdrop} onChange={e => set({ airdrop: e.target.value })} spellCheck={false} />
                </Field>
                {"launch" in built && built.entries.length > 0 && <p className="os-sub os-flush">{built.entries.length} recipients, {units(built.launch.airdropTotal, decimals)} {draft.ticker}.</p>}
            </div>
        )
    } else {
        body = "launch" in built ? <Review network={network} session={session} launch={built.launch} entries={built.entries} onOutcome={(kind, manifest) => setOutcome({ kind, manifest })} sign={signer.sign} /> : <p className="os-note os-err" role="alert">{built.problem.message}</p>
    }

    return (
        <WizardFrame steps={STEPS} step={step}
            onBack={() => { setError(null); setStep(step - 1) }}
            onNext={step < STEPS.length - 1 ? next : undefined} nextLabel="Continue"
            note={<>{error && <span className="os-fe" role="alert">{error}</span>}{(outcome?.kind === "unknown" || outcome?.kind === "failed") && <span className="os-fe" role="alert">{outcome.kind === "unknown" ? "The outcome is unknown. Check the token list before creating again." : "The network refused the creation; the creation fee was not taken. The notification says why."}</span>}<button type="button" className="os-btn os-quiet os-inline" onClick={onClose}>Cancel</button></>}>
            {body}
        </WizardFrame>
    )
}

/**
 * Copy and download for an airdrop manifest. `saved` is the root last copied
 * or downloaded, so a manifest rebuilt for another token ID reads unsaved.
 */
function ManifestSaver({ manifest, amount, saved, onSaved }: { manifest: AirdropManifest; amount: string; saved: string | null; onSaved: (root: string) => void }) {
    const json = JSON.stringify(manifest, null, 2)
    const download = () => {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `airdrop-${manifest.tokenId}-${manifest.root.slice(0, 12)}.json`
        link.click()
        URL.revokeObjectURL(url)
        onSaved(manifest.root)
    }
    return (
        <div className="os-note os-stack os-tight">
            <span>Recipients claim only with proofs from this manifest. Memba does not store it: if it is lost, the airdropped {amount} can never be claimed. Keep it and publish it for them.</span>
            <span className="os-mono os-break">Token {manifest.tokenId} · root {manifest.root}</span>
            <div className="os-row">
                <button type="button" className="os-btn os-quiet" onClick={() => void navigator.clipboard.writeText(json).then(() => onSaved(manifest.root))}>{saved === manifest.root ? "Saved: copy again" : "Copy the manifest"}</button>
                <button type="button" className="os-btn os-quiet" onClick={download}>Download the manifest</button>
            </div>
        </div>
    )
}

function Review({ network, session, launch, entries, onOutcome, sign }: {
    network: string; session: OsSession; launch: DirectLaunch; entries: AirdropEntry[]
    onOutcome: (outcome: string, manifest: AirdropManifest | null) => void; sign: ReturnType<typeof useSigner>["sign"]
}) {
    const [saved, setSaved] = useState<string | null>(null)
    const [problem, setProblem] = useState<string | null>(null)
    const withAirdrop = entries.length > 0
    const live = useQuery({
        queryKey: ["token-launchpad", network, "create-terms", withAirdrop],
        queryFn: async () => {
            const terms = await new TokenLaunchpadSalesClient(network).terms(LAUNCH_CURRENCY)
            const lanes = await Promise.all((withAirdrop ? ["direct", "airdrop"] as const : ["direct"] as const).map(lane => readActionStatus(network, lane, LAUNCH_CURRENCY)))
            const nextId = withAirdrop ? `T${(await new TokenLaunchpadClient(network).count()) + 1n}` : null
            return { terms, open: lanes.every(l => l.open), nextId }
        },
        retry: false,
    })
    const nextId = live.data?.nextId ?? null
    const manifest = useMemo(() => (nextId ? prepareAirdropManifest(nextId, entries) : null), [nextId, entries])
    if (live.isPending) return <Loading label="Reading the launch terms…" />
    if (live.isError) return <ErrorState message="The launch terms could not be read from this network." onRetry={() => void live.refetch()} />
    const { terms, open } = live.data
    const fee = terms.directCreationFee
    const ticker = launch.ticker
    const unsaved = manifest !== null && saved !== manifest.root

    const submit = async () => {
        if (session.status !== "member") { session.openConnect(); return }
        setProblem(null)
        try {
            const gasPrice = await networkGasPriceFresh()
            const request = createDirectRequest({
                network, creator: session.address, launch, terms, airdrop: manifest,
                start: BigInt(Math.floor(Date.now() / 1000)), gasPrice, onSettled: outcome => onOutcome(outcome, manifest),
            })
            // A recheck that finds the terms or the next ID changed also refreshes this review.
            sign({ ...request, recheck: async choice => { try { await request.recheck!(choice) } catch (e) { void live.refetch(); throw e } } })
        } catch (e) {
            setProblem((e as Error).message || "The network fee could not be read. Try again.")
        }
    }

    return (
        <div className="os-stack os-tight">
            <h3 className="os-h os-flush">Review</h3>
            <dl className="os-tokens-facts">
                <dt>Token</dt><dd>{launch.name} ({ticker}), {launch.decimals} decimals</dd>
                <dt>Supply</dt><dd>{units(launch.initialSupply, launch.decimals)} {ticker}{launch.mode === "direct_capped" ? `, at most ${units(launch.maxSupply, launch.decimals)}` : ", fixed"}</dd>
                <dt>To you</dt><dd>{units(creatorShare(launch), launch.decimals)} {ticker}</dd>
                <dt>Allocations</dt><dd>{launch.allocations.length === 0 ? "None" : launch.allocations.map(a => `${units(a.amount, launch.decimals)} to ${a.beneficiary}${a.vestingDays ? ` over ${a.vestingDays} days${a.cliffDays ? `, ${a.cliffDays}-day cliff` : ""}` : ""}`).join("; ")}</dd>
                <dt>Airdrop</dt><dd>{manifest ? `${units(launch.airdropTotal, launch.decimals)} ${ticker} to ${entries.length} recipients, for token ${manifest.tokenId}` : "None"}</dd>
                <dt>Creation fee</dt><dd>{fee === null ? "No terms in GNOT" : fee === 0n ? "Free" : formatUgnotExact(Number(fee))}</dd>
                <dt>Network</dt><dd>{GNO_CHAIN_ID}</dd>
            </dl>
            {manifest && <ManifestSaver manifest={manifest} amount={`${units(launch.airdropTotal, launch.decimals)} ${ticker}`} saved={saved} onSaved={setSaved} />}
            {!open && <p className="os-note os-warn" role="status">The Launchpad is not taking new tokens right now.</p>}
            {unsaved && <p className="os-sub">Copy or download the manifest first: signing waits for it.</p>}
            {problem && <p className="os-fe" role="alert">{problem}</p>}
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!open || fee === null || (session.status === "member" && unsaved)} onClick={() => void submit()}>
                    {session.status === "member" ? "Review and sign" : "Connect to create"}
                </button>
            </div>
        </div>
    )
}

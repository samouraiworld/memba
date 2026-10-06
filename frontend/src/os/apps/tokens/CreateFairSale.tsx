/**
 * The wizard that opens a fair sale for a new Launchpad token: the token, the
 * sale's lots, prices and window, and a review that reads the live launch
 * terms and signs. Guests fill it in; connecting is asked for only to sign.
 *
 * @module os/apps/tokens/CreateFairSale
 */
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID } from "../../../lib/config"
import { formatUgnotExact } from "../../../lib/dao/v2Budget"
import { formatTokenAmount as units, networkGasPriceFresh } from "../../../lib/grc20"
import { readActionStatus, readReserved } from "../../../lib/tokenLaunchpadConfigClient"
import { TokenLaunchpadSalesClient } from "../../../lib/tokenLaunchpadSalesClient"
import { Segmented, Loading, ErrorState } from "../../kit"
import { useSigner } from "../../sign/signerContext"
import type { OsSession } from "../../shell/useOsSession"
import { Field, WizardFrame } from "../../wizard/WizardFrame"
import { LAUNCH_CURRENCY, toBaseUnits } from "./createDirect"
import { createFairRequest, fairLaunchProblem, saleAllocation, SETTLEMENT_DISCLOSURE, type FairLaunch, type FairPart, type FairProblem } from "./createFair"

const STEPS = ["Token", "Sale", "Review"] as const
const STEP_OF: Record<FairPart, number> = { token: 0, sale: 1 }
const GNOT_DECIMALS = 6

interface Draft {
    name: string; ticker: string; decimals: string; supply: string; description: string
    lotSize: string; lots: string; walletCap: string; soft: string
    pricing: "fixed" | "falling"; startPrice: string; floorPrice: string; step: string; everyMinutes: string
    startsInMinutes: string; hours: string
}

const EMPTY: Draft = {
    name: "", ticker: "", decimals: "6", supply: "", description: "",
    lotSize: "", lots: "", walletCap: "", soft: "",
    pricing: "fixed", startPrice: "", floorPrice: "", step: "", everyMinutes: "60",
    startsInMinutes: "10", hours: "24",
}

const whole = (text: string) => (/^\d{1,18}$/.test(text.trim()) ? BigInt(text.trim()) : null)

type Built = { launch: FairLaunch } | { problem: FairProblem }

function build(d: Draft): Built {
    const decimals = Number(d.decimals)
    const token = (message: string) => ({ problem: { part: "token" as const, message } })
    const sale = (message: string) => ({ problem: { part: "sale" as const, message } })
    if (!/^\d{1,2}$/.test(d.decimals) || decimals > 12) return token("Decimals must be 0 to 12.")
    const supply = toBaseUnits(d.supply, decimals)
    if (supply === null) return token("Enter the supply as a number of tokens.")
    const lotSize = toBaseUnits(d.lotSize, decimals)
    const [lots, walletCap] = [whole(d.lots), whole(d.walletCap)]
    if (lotSize === null || lots === null || walletCap === null) return sale("Enter the lot size in tokens, and the lots and the wallet cap as whole numbers.")
    const gnot = (text: string) => toBaseUnits(text, GNOT_DECIMALS)
    const startPrice = gnot(d.startPrice)
    const falling = d.pricing === "falling"
    const floorPrice = falling ? gnot(d.floorPrice) : startPrice
    const step = falling ? gnot(d.step) : 0n
    const every = falling ? whole(d.everyMinutes) : 1n
    const soft = gnot(d.soft)
    if (startPrice === null || floorPrice === null || step === null || every === null || soft === null) return sale("Enter prices and the soft cap in GNOT, and the price step's period in whole minutes.")
    const [startsIn, hours] = [whole(d.startsInMinutes), whole(d.hours)]
    if (startsIn === null || hours === null) return sale("Enter when the sale opens and how long it lasts in whole minutes and hours.")
    const launch: FairLaunch = {
        name: d.name, ticker: d.ticker, decimals, initialSupply: supply, description: d.description,
        lotSize, lots, walletCapLots: walletCap, softQuote: soft,
        startPrice, floorPrice, decrement: step, intervalSeconds: falling ? every * 60n : 60n,
        startsIn: startsIn * 60n, durationSeconds: hours * 3600n,
    }
    const problem = fairLaunchProblem(launch)
    return problem ? { problem } : { launch }
}

export default function CreateFairSale({ network, session, onClose, onCreated }: { network: string; session: OsSession; onClose: () => void; onCreated: () => void }) {
    const [draft, setDraft] = useState<Draft>(EMPTY)
    const [step, setStep] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [outcome, setOutcome] = useState<string | null>(null)
    const signer = useSigner()
    const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setError(null) }
    const built = useMemo(() => build(draft), [draft])
    const decimals = Number(draft.decimals) || 0

    const next = () => {
        if ("problem" in built && STEP_OF[built.problem.part] <= step) { setError(built.problem.message); return }
        setStep(step + 1)
    }

    if (outcome === "confirmed" || outcome === "submitted") {
        return (
            <div className="os-stack">
                <p className="os-note os-ok" role="status">{outcome === "confirmed"
                    ? `The ${draft.ticker} sale is open for orders from its start time.`
                    : `The sale was sent; ${draft.ticker} appears in the list once the network includes it.`}</p>
                <div className="os-row"><button type="button" className="os-btn" onClick={() => { onCreated(); onClose() }}>Back to tokens</button></div>
            </div>
        )
    }

    let body
    if (step === 0) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Token</h3>
                <p className="os-sub os-flush">A fair-sale token has a fixed supply. The lots on offer go into the sale; the rest is yours at once.</p>
                <Field label="Name" htmlFor="os-fair-name" hint="1 to 32 characters.">
                    <input id="os-fair-name" className="os-in" value={draft.name} onChange={e => set({ name: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Ticker" htmlFor="os-fair-ticker" hint="1 to 10 capital letters or digits.">
                    <input id="os-fair-ticker" className="os-in os-mono" value={draft.ticker} onChange={e => set({ ticker: e.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="Decimals" htmlFor="os-fair-dec" hint="How finely a token divides; 6 like GNOT.">
                    <input id="os-fair-dec" className="os-in" inputMode="numeric" value={draft.decimals} onChange={e => set({ decimals: e.target.value })} />
                </Field>
                <Field label="Supply" htmlFor="os-fair-supply" hint="Every token there will ever be.">
                    <input id="os-fair-supply" className="os-in" inputMode="decimal" value={draft.supply} onChange={e => set({ supply: e.target.value })} />
                </Field>
                <Field label="Description" htmlFor="os-fair-desc" hint="Optional, at most 280 bytes.">
                    <textarea id="os-fair-desc" className="os-in os-ta" value={draft.description} onChange={e => set({ description: e.target.value })} />
                </Field>
            </div>
        )
    } else if (step === 1) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h os-flush">Sale</h3>
                <p className="os-sub os-flush">Buyers order whole lots. When the sale ends, or sells out, everyone pays the same closing price and gets back what they paid above it. If it raised less than the soft cap, everyone is refunded.</p>
                <Field label="Lot size" htmlFor="os-fair-lot" hint="Tokens in one lot.">
                    <input id="os-fair-lot" className="os-in" inputMode="decimal" value={draft.lotSize} onChange={e => set({ lotSize: e.target.value })} />
                </Field>
                <Field label="Lots on offer" htmlFor="os-fair-lots" hint="The sale closes when they are all sold.">
                    <input id="os-fair-lots" className="os-in" inputMode="numeric" value={draft.lots} onChange={e => set({ lots: e.target.value })} />
                </Field>
                <Field label="Lots per wallet" htmlFor="os-fair-cap" hint="The most one address may buy.">
                    <input id="os-fair-cap" className="os-in" inputMode="numeric" value={draft.walletCap} onChange={e => set({ walletCap: e.target.value })} />
                </Field>
                <Segmented label="Price" value={draft.pricing} onChange={pricing => set({ pricing })}
                    options={[{ id: "fixed", name: "Fixed" }, { id: "falling", name: "Falling" }]} />
                <Field label={draft.pricing === "fixed" ? "Price per lot (GNOT)" : "Start price per lot (GNOT)"} htmlFor="os-fair-start">
                    <input id="os-fair-start" className="os-in" inputMode="decimal" value={draft.startPrice} onChange={e => set({ startPrice: e.target.value })} />
                </Field>
                {draft.pricing === "falling" && <>
                    <Field label="Floor price per lot (GNOT)" htmlFor="os-fair-floor" hint="The price never falls below it.">
                        <input id="os-fair-floor" className="os-in" inputMode="decimal" value={draft.floorPrice} onChange={e => set({ floorPrice: e.target.value })} />
                    </Field>
                    <Field label="Price step (GNOT)" htmlFor="os-fair-step">
                        <input id="os-fair-step" className="os-in" inputMode="decimal" value={draft.step} onChange={e => set({ step: e.target.value })} />
                    </Field>
                    <Field label="Every (minutes)" htmlFor="os-fair-every">
                        <input id="os-fair-every" className="os-in" inputMode="numeric" value={draft.everyMinutes} onChange={e => set({ everyMinutes: e.target.value })} />
                    </Field>
                </>}
                <Field label="Soft cap (GNOT)" htmlFor="os-fair-soft" hint="What the sale must raise at its closing price to succeed.">
                    <input id="os-fair-soft" className="os-in" inputMode="decimal" value={draft.soft} onChange={e => set({ soft: e.target.value })} />
                </Field>
                <Field label="Opens in (minutes)" htmlFor="os-fair-in" hint="At least 10, counted from when you sign; up to 365 days.">
                    <input id="os-fair-in" className="os-in" inputMode="numeric" value={draft.startsInMinutes} onChange={e => set({ startsInMinutes: e.target.value })} />
                </Field>
                <Field label="Lasts (hours)" htmlFor="os-fair-hours" hint="Up to 365 days.">
                    <input id="os-fair-hours" className="os-in" inputMode="numeric" value={draft.hours} onChange={e => set({ hours: e.target.value })} />
                </Field>
                {"launch" in built && <p className="os-sub os-flush">On sale: {units(saleAllocation(built.launch), decimals)} {draft.ticker}; to you now: {units(built.launch.initialSupply - saleAllocation(built.launch), decimals)} {draft.ticker}.</p>}
            </div>
        )
    } else {
        body = "launch" in built ? <Review network={network} session={session} launch={built.launch} onOutcome={setOutcome} sign={signer.sign} /> : <p className="os-note os-err" role="alert">{built.problem.message}</p>
    }

    return (
        <WizardFrame steps={STEPS} step={step}
            onBack={() => { setError(null); setStep(step - 1) }}
            onNext={step < STEPS.length - 1 ? next : undefined} nextLabel="Continue"
            note={<>{error && <span className="os-fe" role="alert">{error}</span>}{(outcome === "unknown" || outcome === "failed") && <span className="os-fe" role="alert">{outcome === "unknown" ? "The outcome is unknown. Check the token list before opening the sale again." : "The network refused the sale; the creation fee was not taken. The notification says why."}</span>}<button type="button" className="os-btn os-quiet os-inline" onClick={onClose}>Cancel</button></>}>
            {body}
        </WizardFrame>
    )
}

function Review({ network, session, launch, onOutcome, sign }: {
    network: string; session: OsSession; launch: FairLaunch
    onOutcome: (outcome: string) => void; sign: ReturnType<typeof useSigner>["sign"]
}) {
    const [problem, setProblem] = useState<string | null>(null)
    const live = useQuery({
        queryKey: ["token-launchpad", network, "fair-terms", launch.ticker],
        queryFn: async () => {
            const terms = await new TokenLaunchpadSalesClient(network).terms(LAUNCH_CURRENCY)
            const [lane, reserved] = await Promise.all([readActionStatus(network, "fairsale", LAUNCH_CURRENCY), readReserved(network, launch.ticker)])
            return { terms, open: lane.open, reserved }
        },
        retry: false,
    })
    if (live.isPending) return <Loading label="Reading the launch terms…" />
    if (live.isError) return <ErrorState message="The launch terms could not be read from this network." onRetry={() => void live.refetch()} />
    const { terms, open, reserved } = live.data
    const fee = terms.fairSaleCreationFee
    const t = launch.ticker
    const termsProblem = fee === null || terms.primaryFeeBps === null ? "Fair sales have no terms in GNOT on this network."
        : reserved ? `${t} is reserved on the Launchpad; choose another ticker.`
        : fairLaunchProblem(launch, terms.fairSaleRaiseCap)?.message ?? null
    const gnot = formatUgnotExact

    const submit = async () => {
        if (session.status !== "member") { session.openConnect(); return }
        setProblem(null)
        try {
            const gasPrice = await networkGasPriceFresh()
            const request = createFairRequest({
                network, creator: session.address, launch, terms, now: BigInt(Math.floor(Date.now() / 1000)), gasPrice, onSettled: onOutcome,
            })
            sign({ ...request, recheck: async choice => { try { await request.recheck!(choice) } catch (e) { void live.refetch(); throw e } } })
        } catch (e) {
            setProblem((e as Error).message || "The network fee could not be read. Try again.")
        }
    }

    return (
        <div className="os-stack os-tight">
            <h3 className="os-h os-flush">Review</h3>
            <dl className="os-tokens-facts">
                <dt>Token</dt><dd>{launch.name} ({t}), {launch.decimals} decimals, {units(launch.initialSupply, launch.decimals)} fixed</dd>
                <dt>To you now</dt><dd>{units(launch.initialSupply - saleAllocation(launch), launch.decimals)} {t}</dd>
                <dt>On sale</dt><dd>{launch.lots.toString()} lots of {units(launch.lotSize, launch.decimals)} {t}, at most {launch.walletCapLots.toString()} per wallet</dd>
                <dt>Price per lot</dt><dd>{launch.decrement === 0n ? gnot(launch.startPrice) : `${gnot(launch.startPrice)}, falling ${gnot(launch.decrement)} every ${launch.intervalSeconds / 60n} min to ${gnot(launch.floorPrice)}`}</dd>
                <dt>Window</dt><dd>Opens {(launch.startsIn / 60n).toString()} min after you sign, for {(launch.durationSeconds / 3600n).toString()} h, or until sold out</dd>
                <dt>Soft cap</dt><dd>{gnot(launch.softQuote)}</dd>
                <dt>Primary fee</dt><dd>{terms.primaryFeeBps === null ? "No terms" : `${Number(terms.primaryFeeBps) / 100}% of what the sale raises`}</dd>
                <dt>Creation fee</dt><dd>{fee === null ? "No terms in GNOT" : fee === 0n ? "Free" : gnot(fee)}</dd>
                <dt>Network</dt><dd>{GNO_CHAIN_ID}</dd>
            </dl>
            <p className="os-note">{SETTLEMENT_DISCLOSURE}</p>
            {!open && <p className="os-note os-warn" role="status">The Launchpad is not opening new sales right now.</p>}
            {termsProblem && <p className="os-note os-warn" role="status">{termsProblem}</p>}
            {problem && <p className="os-fe" role="alert">{problem}</p>}
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!open || termsProblem !== null} onClick={() => void submit()}>
                    {session.status === "member" ? "Review and sign" : "Connect to open the sale"}
                </button>
            </div>
        </div>
    )
}

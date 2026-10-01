/**
 * Tokens native home: the Token Launchpad's tokens and each one's launch, read
 * from the ledger and sales realms. Available where the network's allowlist
 * names the ledger, which it does on none until the realms are published;
 * elsewhere the classic token factory pages where that factory exists, or a
 * note saying the Launchpad is not here. Guests browse everything; a member
 * also sees their balance, their fair-sale order and what it pays. Reads are
 * strict: a failed read is an error with a retry, data that breaks the
 * realms' rules is called unusable, and neither is shown as empty.
 *
 * @module os/apps/tokens/native
 */
import { Fragment, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { GRC20_FACTORY_PATH, isRealmValidOn } from "../../../lib/config"
import { formatTokenAmount as units, networkGasPriceFresh, type GasPrice } from "../../../lib/grc20"
import { verifyAirdropManifest, type AirdropManifest } from "../../../lib/tokenLaunchpadAirdropManifest"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { TokenLaunchpadClient, TokenLaunchpadReadError, TOKEN_LAUNCHPAD_PATH, type LaunchpadToken } from "../../../lib/tokenLaunchpadClient"
import { TokenLaunchpadSalesClient, TOKEN_LAUNCHPAD_SALES_PATH, type FairSaleView, type LaunchView } from "../../../lib/tokenLaunchpadSalesClient"
import { readActionStatus, TOKEN_LAUNCHPAD_CONFIG_PATH } from "../../../lib/tokenLaunchpadConfigClient"
import { Empty, ErrorState, Loading, Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import type { OsSession } from "../../shell/useOsSession"
import type { SignRequest } from "../../sign/signer"
import { useSigner } from "../../sign/signerContext"
import { airdropClaimRequest, claimableNow, vestingClaimRequest } from "./claims"
import CreateToken from "./CreateToken"
import { canSettle, CLOCK_MARGIN, holdingGates, priceAt, PROOF_FORMAT, saleActionRequest, takingOrders, type SaleAction } from "./saleActions"
import "./native.css"

const PAGE = 20
const MODE_LABEL: Record<LaunchpadToken["mode"], string> = { direct_fixed: "Fixed supply", direct_capped: "Capped supply", fairsale: "Fair sale" }

function quote(amount: bigint, currency: string): string {
    return currency === "ugnot" ? `${units(amount, 6)} GNOT` : `${amount} base units of ${revealInvisibleFormatting(currency)}`
}

// A Date holds at most 8.64e15 ms; the contract bounds no timestamp.
function time(seconds: bigint): string {
    return seconds <= 8_640_000_000_000n ? new Date(Number(seconds) * 1000).toLocaleString() : `Unix time ${seconds}`
}

/** The current Unix second, refreshed every 30 seconds so a status changes with the clock. */
function useNow(): bigint {
    const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
    useEffect(() => {
        const timer = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 30_000)
        return () => clearInterval(timer)
    }, [])
    return now
}

function failure(error: unknown, what: string, retry: () => void) {
    return error instanceof TokenLaunchpadReadError && error.code === "invalid_response"
        ? <ErrorState message={`This network's ${what} does not follow the Launchpad's rules, so it is not shown.`} />
        : <ErrorState message={`The ${what} could not be read from this network.`} onRetry={retry} />
}

/** Whether the sale takes orders now depends on its window and on config's fair-sale lane. */
function saleStatus(sale: FairSaleView, now: bigint, laneOpen: boolean | undefined): string {
    if (sale.cancelled) return "Cancelled before any order; the allocation went back to the creator."
    if (sale.settled) return sale.succeeded ? "Settled: the sale succeeded." : "Settled: the sale missed its soft cap, so every buyer can claim a full refund."
    if (sale.hardClosedAt !== 0n || now >= sale.end) return "Closed; anyone can settle it now."
    const window = now < sale.start ? `Opens ${time(sale.start)}, closes ${time(sale.end)}.` : `Open until ${time(sale.end)}.`
    return laneOpen === false ? `${window} New orders are paused on the Launchpad; settlement and claims are not affected.` : window
}

export default function TokensWindow({ session, fallback }: NativeViewProps) {
    const network = session.network.key
    if (isRealmValidOn(network, TOKEN_LAUNCHPAD_PATH)) {
        return <Launchpad network={network} session={session} />
    }
    if (isRealmValidOn(network, GRC20_FACTORY_PATH)) return <>{fallback}</>
    return (
        <div className="os-stack">
            <div className="os-note os-warn" role="note">
                <Pill tone="neutral">Token Launchpad unavailable here</Pill>
                {network === "mainnet" ? ` The Token Launchpad is not deployed on ${session.network.chainId}.` : " The Token Launchpad is not available on this network."}
            </div>
        </div>
    )
}

function Launchpad({ network, session }: { network: string; session: OsSession }) {
    const [page, setPage] = useState(0)
    const [selected, setSelected] = useState<LaunchpadToken | null>(null)
    const [creating, setCreating] = useState(false)
    const queries = useQueryClient()
    const tokens = useQuery({
        queryKey: ["token-launchpad", network, "page", page],
        queryFn: () => new TokenLaunchpadClient(network).listPage(page, PAGE),
        staleTime: 30_000, retry: false,
    })
    const turn = (next: number) => { setPage(next); setSelected(null) }
    if (creating) {
        return <CreateToken network={network} session={session} onClose={() => setCreating(false)}
            onCreated={() => void queries.invalidateQueries({ queryKey: ["token-launchpad", network] })} />
    }

    return (
        <div className="os-stack os-tokens">
            {isRealmValidOn(network, TOKEN_LAUNCHPAD_SALES_PATH) && isRealmValidOn(network, TOKEN_LAUNCHPAD_CONFIG_PATH) && <div className="os-row">
                <button type="button" className="os-btn" onClick={() => setCreating(true)}>Create a token</button>
            </div>}
            <section aria-labelledby="tokens-list" className="os-stack os-tight">
                <h3 className="os-h" id="tokens-list">Launchpad tokens</h3>
                {tokens.isPending ? <Loading label="Reading tokens…" />
                    : tokens.isError ? failure(tokens.error, "token list", () => void tokens.refetch())
                    : tokens.data.length === 0 ? <Empty title={page === 0 ? "No token has been created yet." : "No more tokens."} />
                    : <ul className="os-list os-tokens-list" aria-label="Launchpad tokens">
                        {tokens.data.map(token => (
                            <li key={token.id}>
                                <button type="button" className="os-scard" aria-pressed={selected?.id === token.id} onClick={() => setSelected(token)}>
                                    <span className="os-grow">
                                        <b>{revealInvisibleFormatting(token.name)}</b>
                                        <span className="os-sub os-block">{revealInvisibleFormatting(token.ticker)} · {token.id}</span>
                                    </span>
                                    <Pill tone="neutral">{MODE_LABEL[token.mode]}</Pill>
                                </button>
                            </li>
                        ))}
                    </ul>}
                <div className="os-row">
                    <button type="button" className="os-btn os-quiet" disabled={page === 0 || tokens.isFetching} onClick={() => turn(page - 1)}>Previous</button>
                    <span className="os-sub">Page {page + 1}</span>
                    <button type="button" className="os-btn os-quiet" disabled={!tokens.data || tokens.data.length < PAGE || tokens.isFetching} onClick={() => turn(page + 1)}>Next</button>
                </div>
            </section>
            {selected && <TokenDetails key={selected.id} network={network} session={session} token={selected} />}
        </div>
    )
}

function TokenDetails({ network, session, token }: { network: string; session: OsSession; token: LaunchpadToken }) {
    const address = session.status === "member" ? session.address : null
    const salesAvailable = isRealmValidOn(network, TOKEN_LAUNCHPAD_SALES_PATH)
    const balance = useQuery({
        queryKey: ["token-launchpad", network, "balance", token.id, address],
        queryFn: () => new TokenLaunchpadClient(network).balanceOf(token.id, address!),
        enabled: address !== null, retry: false,
    })
    const launch = useQuery({
        queryKey: ["token-launchpad", network, "launch", token.id],
        queryFn: () => new TokenLaunchpadSalesClient(network).launch(token.id),
        enabled: salesAvailable, retry: false,
    })
    const ticker = revealInvisibleFormatting(token.ticker)

    return (
        <section aria-labelledby="token-details" className="os-stack os-tight">
            <h3 className="os-h" id="token-details">{revealInvisibleFormatting(token.name)} ({ticker})</h3>
            <dl className="os-tokens-facts">
                <dt>Token</dt><dd className="os-mono">{token.id}</dd>
                <dt>Supply</dt><dd>{units(token.totalSupply, token.decimals)} {ticker}{token.mode === "direct_capped" && ` of at most ${units(token.maxSupply, token.decimals)}`}</dd>
                <dt>Creator</dt><dd className="os-mono">{token.creator}</dd>
                <dt>Issuer</dt><dd className="os-mono">{token.issuer}</dd>
                <dt>Registry key</dt><dd className="os-mono">{token.registryKey}</dd>
                {token.description && <><dt>About</dt><dd>{revealInvisibleFormatting(token.description)}</dd></>}
            </dl>
            {address !== null && (balance.isPending ? <Loading label="Reading your balance…" />
                : balance.isError ? failure(balance.error, "balance", () => void balance.refetch())
                : <p>Your balance: <b>{units(balance.data, token.decimals)} {ticker}</b></p>)}
            {!salesAvailable ? <p className="os-sub">Launch details are not available on this network.</p>
                : launch.isPending ? <Loading label="Reading the launch…" />
                : launch.isError ? failure(launch.error, "launch", () => void launch.refetch())
                : <LaunchSections network={network} session={session} launch={launch.data} />}
        </section>
    )
}

function LaunchSections({ network, session, launch }: { network: string; session: OsSession; launch: LaunchView }) {
    const { fairSale, airdrop, vestingCount } = launch
    if (!fairSale && !airdrop && vestingCount === 0) return <p className="os-sub">This token has no sale, airdrop or vesting.</p>
    return (
        <div className="os-stack os-tight">
            {fairSale && <FairSale network={network} session={session} launch={launch} sale={fairSale} />}
            {airdrop && <Airdrop network={network} session={session} launch={launch} />}
            {vestingCount > 0 && <Vesting network={network} session={session} launch={launch} />}
        </div>
    )
}

/**
 * Signs a Launchpad call for a member; a guest is asked to connect first. The
 * outcome is worded for the window, and the token is read again once it lands.
 */
function useLaunchCall(network: string, session: OsSession) {
    const signer = useSigner()
    const queries = useQueryClient()
    const [message, setMessage] = useState<string | null>(null)
    const act = async (build: (caller: string, gasPrice: GasPrice, onSettled: (outcome: string) => void) => SignRequest) => {
        if (session.status !== "member") { session.openConnect(); return }
        setMessage(null)
        try {
            const gasPrice = await networkGasPriceFresh()
            signer.sign(build(session.address, gasPrice, outcome => {
                if (outcome === "confirmed" || outcome === "submitted") void queries.invalidateQueries({ queryKey: ["token-launchpad", network] })
                setMessage(outcome === "confirmed" ? "Done." : outcome === "submitted" ? "Sent; this view updates once the network includes it."
                    : outcome === "unknown" ? "The outcome is unknown. Read the token again before retrying." : null)
            }))
        } catch (e) {
            setMessage((e as Error).message || "The network fee could not be read. Try again.")
        }
    }
    return { act, message }
}

function FairSale({ network, session, launch, sale }: { network: string; session: OsSession; launch: LaunchView; sale: FairSaleView }) {
    const token = launch.token
    const address = session.status === "member" ? session.address : null
    const member = address !== null
    const ticker = revealInvisibleFormatting(token.ticker)
    const call = useLaunchCall(network, session)
    const message = call.message
    const act = (action: SaleAction) => call.act((caller, gasPrice, onSettled) =>
        saleActionRequest({ network, caller, launch, action, gasPrice, now: BigInt(Math.floor(Date.now() / 1000)), onSettled }))
    const [lots, setLots] = useState("1")
    const [proof, setProof] = useState("")
    const buyer = useQuery({
        queryKey: ["token-launchpad", network, "buyer", token.id, address],
        queryFn: () => new TokenLaunchpadSalesClient(network).fairBuyer(token.id, address!),
        enabled: address !== null, retry: false,
    })
    const now = useNow()
    const taking = !sale.cancelled && !sale.settled && sale.hardClosedAt === 0n && now < sale.end
    const lane = useQuery({
        queryKey: ["token-launchpad", network, "lane", "fairsale", sale.quoteCurrency],
        queryFn: () => readActionStatus(network, "fairsale", sale.quoteCurrency),
        enabled: taking, staleTime: 30_000, retry: false,
    })
    const lot = `${units(sale.lotSize, token.decimals)} ${ticker}`
    const sold = sale.settled && sale.succeeded
    const ordering = sale.quoteCurrency === "ugnot" && takingOrders(sale, now, CLOCK_MARGIN) && lane.data?.open === true
    const ordered = /^[1-9]\d{0,9}$/.test(lots) ? BigInt(lots) : null
    const mine = buyer.data?.lots ?? 0n
    const room = [sale.walletCapLots - mine, sale.hardCapLots - sale.totalLots].reduce((a, b) => (a < b ? a : b))
    const proofOk = PROOF_FORMAT.test(proof)
    const settleable = canSettle(sale, now)
    const gates = holdingGates(sale)

    return (
        <div>
            <h4 className="os-h">Fair sale</h4>
            <p>{saleStatus(sale, now, taking ? lane.data?.open : undefined)}</p>
            {taking && lane.isError && failure(lane.error, "fair-sale lane status", () => void lane.refetch())}
            <dl className="os-tokens-facts">
                <dt>{sold ? "Sold" : "Ordered"}</dt><dd>{sale.totalLots.toString()} of {sale.hardCapLots.toString()} lots of {lot}</dd>
                <dt>Price per lot</dt><dd>{sale.startPrice === sale.floorPrice ? quote(sale.startPrice, sale.quoteCurrency) : `from ${quote(sale.startPrice, sale.quoteCurrency)} down to ${quote(sale.floorPrice, sale.quoteCurrency)}`}</dd>
                <dt>Soft cap</dt><dd>{quote(sale.softCapQuote, sale.quoteCurrency)}</dd>
                <dt>Per wallet</dt><dd>at most {sale.walletCapLots.toString()} lots</dd>
                {gates.map(g => <Fragment key={g.tokenId}><dt>Holding gate</dt><dd>at least {g.minimum.toString()} base units of {g.tokenId}</dd></Fragment>)}
                <dt>Protocol fee</dt><dd>{units(sale.primaryFeeBps, 2)}% of what is raised</dd>
                {sold && <>
                    <dt>Raised</dt><dd>{quote(sale.grossQuote, sale.quoteCurrency)} at {quote(sale.closePrice, sale.quoteCurrency)} per lot</dd>
                    <dt>To the creator</dt><dd>{quote(sale.creatorQuote, sale.quoteCurrency)} {sale.proceedsReleased ? "(paid)" : "(anyone can release it)"}</dd>
                    <dt>Fee</dt><dd>{quote(sale.primaryFeeQuote, sale.quoteCurrency)}</dd>
                </>}
            </dl>
            {address !== null && (buyer.isPending ? <Loading label="Reading your order…" />
                : buyer.isError ? failure(buyer.error, "order", () => void buyer.refetch())
                : buyer.data.lots === 0n ? <p className="os-sub">You have no order in this sale.</p>
                : <p>Your order: {buyer.data.lots.toString()} lots, {quote(buyer.data.deposit, sale.quoteCurrency)} deposited. {
                    buyer.data.claimed ? "Paid out."
                        : !buyer.data.settled ? "What it pays is known once the sale is settled."
                        : `It pays ${units(buyer.data.claimableTokens, token.decimals)} ${ticker} and ${quote(buyer.data.claimableRefund, sale.quoteCurrency)} back.`}</p>)}
            {buyer.data && buyer.data.settled && !buyer.data.claimed && buyer.data.lots > 0n && (
                <div className="os-row"><button type="button" className="os-btn" onClick={() => void act({ kind: "claim", buyer: buyer.data.buyer, claimableTokens: buyer.data.claimableTokens, claimableRefund: buyer.data.claimableRefund })}>Claim</button></div>
            )}
            {ordering && <div className="os-stack os-tight">
                {sale.allowlistRoot && <label className="os-fl"><span className="os-fll">Allowlist proof, from the sale's creator (empty for a one-address list)</span>
                    <textarea className="os-in os-ta os-mono" value={proof} onChange={e => setProof(e.target.value.trim())} spellCheck={false} />
                    {!proofOk && <span className="os-fe" role="alert">A proof is lowercase hashes separated by commas.</span>}
                </label>}
                <div className="os-row">
                    <input className="os-in os-tokens-lots" inputMode="numeric" value={lots} onChange={e => setLots(e.target.value)} aria-label="Lots to order" />
                    <span className="os-sub os-grow">{ordered === null ? "Whole lots only." : ordered > room ? `You can order up to ${room} lots.` : `${units(ordered * sale.lotSize, token.decimals)} ${ticker} for at most ${quote(ordered * priceAt(sale, now - sale.intervalSeconds > sale.start ? now - sale.intervalSeconds : sale.start), sale.quoteCurrency)}`}</span>
                    <button type="button" className="os-btn" disabled={ordered === null || ordered > room || !proofOk} onClick={() => ordered !== null && void act({ kind: "order", lots: ordered, proof, mine })}>{member ? "Order" : "Connect to order"}</button>
                </div>
            </div>}
            {settleable && <div className="os-row"><button type="button" className="os-btn" onClick={() => void act({ kind: "settle" })}>{member ? "Settle the sale" : "Connect to settle"}</button></div>}
            {sold && !sale.proceedsReleased && <div className="os-row"><button type="button" className="os-btn os-quiet" onClick={() => void act({ kind: "release" })}>{member ? "Release the proceeds" : "Connect to release the proceeds"}</button></div>}
            {message && <p className="os-sub" role="status">{message}</p>}
        </div>
    )
}

function Vesting({ network, session, launch }: { network: string; session: OsSession; launch: LaunchView }) {
    const { token, vestingCount: count } = launch
    const [index, setIndex] = useState(0)
    const ticker = revealInvisibleFormatting(token.ticker)
    const now = useNow()
    const call = useLaunchCall(network, session)
    const record = useQuery({
        queryKey: ["token-launchpad", network, "vesting", token.id, index],
        queryFn: () => new TokenLaunchpadSalesClient(network).vesting(token.id, index),
        retry: false,
    })
    const due = record.data ? claimableNow(record.data, now) : 0n
    return (
        <div>
            <h4 className="os-h">Vesting</h4>
            {record.isPending ? <Loading label="Reading the vesting record…" />
                : record.isError ? failure(record.error, "vesting record", () => void record.refetch())
                : <>
                    <p>Record {index + 1} of {count}: {units(record.data.claimed, token.decimals)} of {units(record.data.revoked ? record.data.revokedVested : record.data.total, token.decimals)} {ticker} claimed{record.data.revoked && `, revoked: ${units(record.data.revokedVested, token.decimals)} of the ${units(record.data.total, token.decimals)} had vested`}, for <span className="os-mono">{record.data.beneficiary}</span>.</p>
                    {record.data.pendingBeneficiary && <p className="os-sub">A move of this record to <span className="os-mono">{record.data.pendingBeneficiary}</span> is pending; no claim until it is accepted or cancelled.</p>}
                    {due > 0n && <div className="os-row">
                        <button type="button" className="os-btn" onClick={() => void call.act((caller, gasPrice, onSettled) => vestingClaimRequest({ network, caller, launch, record: record.data, now, gasPrice, onSettled }))}>
                            {session.status === "member" ? `Claim ${units(due, token.decimals)} ${ticker} for the beneficiary` : "Connect to claim"}
                        </button>
                    </div>}
                </>}
            {call.message && <p className="os-sub" role="status">{call.message}</p>}
            {count > 1 && <div className="os-row">
                <button type="button" className="os-btn os-quiet" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous record</button>
                <button type="button" className="os-btn os-quiet" disabled={index + 1 >= count} onClick={() => setIndex(index + 1)}>Next record</button>
            </div>}
        </div>
    )
}

/**
 * An airdrop's progress and, from the manifest its creator published, the
 * member's own leaves to claim. The manifest is checked against the root and
 * total recorded on chain before any leaf is offered.
 */
function Airdrop({ network, session, launch }: { network: string; session: OsSession; launch: LaunchView }) {
    const { token, airdrop } = launch
    const ticker = revealInvisibleFormatting(token.ticker)
    const call = useLaunchCall(network, session)
    const [text, setText] = useState("")
    // Parsing and rebuilding up to 100,000 leaves happens once per pasted text, not per render.
    const { manifest, problem } = useMemo((): { manifest: AirdropManifest | null; problem: string | null } => {
        if (!text.trim() || !airdrop) return { manifest: null, problem: null }
        let parsed: AirdropManifest
        try { parsed = JSON.parse(text) as AirdropManifest } catch { return { manifest: null, problem: "This is not a manifest: it does not read as JSON." } }
        try {
            return { manifest: verifyAirdropManifest(parsed, { tokenId: token.id, root: airdrop.root, total: airdrop.total.toString() }), problem: null }
        } catch {
            return { manifest: null, problem: "This manifest does not match the airdrop recorded on chain." }
        }
    }, [text, token.id, airdrop])
    const address = session.status === "member" ? session.address : null
    const mine = manifest && address ? manifest.claims.filter(c => c.beneficiary === address) : []
    const claimed = useQuery({
        queryKey: ["token-launchpad", network, "airdrop-claimed", token.id, mine.map(c => c.index).join(",")],
        queryFn: () => Promise.all(mine.map(c => new TokenLaunchpadSalesClient(network).airdropClaimed(token.id, c.index))),
        enabled: mine.length > 0, retry: false,
    })
    if (!airdrop) return null
    return (
        <div className="os-stack os-tight">
            <h4 className="os-h">Airdrop</h4>
            <p>{units(airdrop.claimed, token.decimals)} of {units(airdrop.total, token.decimals)} {ticker} claimed.</p>
            <label className="os-fl"><span className="os-fll">The airdrop's manifest, as its creator published it</span>
                <textarea className="os-in os-ta os-mono" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
            </label>
            {problem && <p className="os-fe" role="alert">{problem}</p>}
            {manifest && (address === null
                ? <div className="os-row"><button type="button" className="os-btn" onClick={() => session.openConnect()}>Connect to see your claims</button></div>
                : mine.length === 0 ? <p className="os-sub">This airdrop has nothing for {address}.</p>
                : claimed.isPending ? <Loading label="Reading your claims…" />
                : claimed.isError ? failure(claimed.error, "airdrop claims", () => void claimed.refetch())
                : <ul className="os-list os-stack os-tight">{mine.map((c, i) => <li key={c.index} className="os-row">
                    <span className="os-grow">{units(BigInt(c.amount), token.decimals)} {ticker}</span>
                    {claimed.data[i] ? <span className="os-sub">Claimed</span>
                        : <button type="button" className="os-btn" onClick={() => void call.act((caller, gasPrice, onSettled) => airdropClaimRequest({ network, caller, launch, claim: c, gasPrice, onSettled }))}>Claim from the airdrop</button>}
                </li>)}</ul>)}
            {call.message && <p className="os-sub" role="status">{call.message}</p>}
        </div>
    )
}

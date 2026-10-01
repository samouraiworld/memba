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
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GRC20_FACTORY_PATH, isRealmValidOn } from "../../../lib/config"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { TokenLaunchpadClient, TokenLaunchpadReadError, TOKEN_LAUNCHPAD_PATH, type LaunchpadToken } from "../../../lib/tokenLaunchpadClient"
import { TokenLaunchpadSalesClient, TOKEN_LAUNCHPAD_SALES_PATH, type FairSaleView, type LaunchView } from "../../../lib/tokenLaunchpadSalesClient"
import { readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import { Empty, ErrorState, Loading, Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import "./native.css"

const PAGE = 20
const MODE_LABEL: Record<LaunchpadToken["mode"], string> = { direct_fixed: "Fixed supply", direct_capped: "Capped supply", fairsale: "Fair sale" }

/** An exact decimal rendering of base units; no float on the way. */
function units(amount: bigint, decimals: number): string {
    if (decimals === 0) return amount.toString()
    const digits = amount.toString().padStart(decimals + 1, "0")
    const fraction = digits.slice(-decimals).replace(/0+$/, "")
    return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "")
}

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
        return <Launchpad network={network} address={session.status === "member" ? session.address : null} />
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

function Launchpad({ network, address }: { network: string; address: string | null }) {
    const [page, setPage] = useState(0)
    const [selected, setSelected] = useState<LaunchpadToken | null>(null)
    const tokens = useQuery({
        queryKey: ["token-launchpad", network, "page", page],
        queryFn: () => new TokenLaunchpadClient(network).listPage(page, PAGE),
        staleTime: 30_000, retry: false,
    })
    const turn = (next: number) => { setPage(next); setSelected(null) }

    return (
        <div className="os-stack os-tokens">
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
            {selected && <TokenDetails key={selected.id} network={network} address={address} token={selected} />}
        </div>
    )
}

function TokenDetails({ network, address, token }: { network: string; address: string | null; token: LaunchpadToken }) {
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
                : <LaunchSections network={network} address={address} launch={launch.data} />}
        </section>
    )
}

function LaunchSections({ network, address, launch }: { network: string; address: string | null; launch: LaunchView }) {
    const { token, fairSale, airdrop, vestingCount } = launch
    const ticker = revealInvisibleFormatting(token.ticker)
    if (!fairSale && !airdrop && vestingCount === 0) return <p className="os-sub">This token has no sale, airdrop or vesting.</p>
    return (
        <div className="os-stack os-tight">
            {fairSale && <FairSale network={network} address={address} token={token} sale={fairSale} />}
            {airdrop && <div>
                <h4 className="os-h">Airdrop</h4>
                <p>{units(airdrop.claimed, token.decimals)} of {units(airdrop.total, token.decimals)} {ticker} claimed.</p>
            </div>}
            {vestingCount > 0 && <Vesting network={network} token={token} count={vestingCount} />}
        </div>
    )
}

function FairSale({ network, address, token, sale }: { network: string; address: string | null; token: LaunchpadToken; sale: FairSaleView }) {
    const ticker = revealInvisibleFormatting(token.ticker)
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
        </div>
    )
}

function Vesting({ network, token, count }: { network: string; token: LaunchpadToken; count: number }) {
    const [index, setIndex] = useState(0)
    const ticker = revealInvisibleFormatting(token.ticker)
    const record = useQuery({
        queryKey: ["token-launchpad", network, "vesting", token.id, index],
        queryFn: () => new TokenLaunchpadSalesClient(network).vesting(token.id, index),
        retry: false,
    })
    return (
        <div>
            <h4 className="os-h">Vesting</h4>
            {record.isPending ? <Loading label="Reading the vesting record…" />
                : record.isError ? failure(record.error, "vesting record", () => void record.refetch())
                : <>
                    <p>Record {index + 1} of {count}: {units(record.data.claimed, token.decimals)} of {units(record.data.revoked ? record.data.revokedVested : record.data.total, token.decimals)} {ticker} claimed{record.data.revoked && `, revoked: ${units(record.data.revokedVested, token.decimals)} of the ${units(record.data.total, token.decimals)} had vested`}, for <span className="os-mono">{record.data.beneficiary}</span>.</p>
                    {record.data.pendingBeneficiary && <p className="os-sub">A move of this record to <span className="os-mono">{record.data.pendingBeneficiary}</span> is pending; no claim until it is accepted or cancelled.</p>}
                </>}
            {count > 1 && <div className="os-row">
                <button type="button" className="os-btn os-quiet" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous record</button>
                <button type="button" className="os-btn os-quiet" disabled={index + 1 >= count} onClick={() => setIndex(index + 1)}>Next record</button>
            </div>}
        </div>
    )
}

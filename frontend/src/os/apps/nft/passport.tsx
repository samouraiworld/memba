/**
 * The Collection Passport: what the ledger enforces for a collection, one
 * true statement per line and never more. Where the ledger takes someone's
 * word (a listed market paying royalties), the line says whose.
 *
 * @module os/apps/nft/passport
 */
import { useQuery } from "@tanstack/react-query"
import { formatBPS } from "../../../lib/nft/format"
import { getCapabilities, type NftCapabilities, type NftCollection } from "../../../lib/nft/ledger"
import { Loading } from "../../kit"
import { ReadFailure } from "./parts"
import type { NftScreen } from "./screen"

const count = (n: number | bigint, one: string, many: string) => `${n} ${n === 1 || n === 1n ? one : many}`

function Accounts({ accounts }: { accounts: readonly { account: string; share?: string }[] }) {
    return (
        <ul className="os-nft-lines">
            {accounts.map(({ account, share }) => <li key={account}><span className="os-mono os-break">{account}</span>{share && ` · ${share}`}</li>)}
        </ul>
    )
}

function metadataLine(cap: NftCapabilities, revision: bigint): string {
    if (cap.metadataMode === "static") return "Token metadata is fixed on IPFS."
    if (cap.metadataMode === "reveal") {
        return cap.metadataFrozen
            ? "Token metadata was revealed and is now fixed."
            : "Token metadata is a placeholder until the creator reveals it. The reveal must match a commitment made when the collection was created."
    }
    return cap.metadataFrozen ? `Token metadata is frozen, at revision ${revision}.` : `The creator can still change token metadata (revision ${revision}).`
}

function Lines({ collection, cap }: { collection: NftCollection; cap: NftCapabilities }) {
    return (
        <ul className="os-nft-lines">
            <li>{cap.holderTransfer ? "Holders can transfer their tokens directly." : cap.mode === "soulbound" ? "Tokens are soulbound: once minted, they never move." : "Holders cannot transfer tokens directly."}</li>
            <li>
                {!cap.marketSale ? "Tokens cannot be sold on a market."
                    : cap.markets.length === 0 ? "A holder can approve any market to sell a token."
                    : <>Tokens move only through the {count(cap.markets.length, "market", "markets")} the creator listed:<Accounts accounts={cap.markets.map((account) => ({ account }))} /></>}
            </li>
            <li>
                {cap.royaltyBPS === 0n ? "No royalty is set." : <>
                    A royalty of {formatBPS(cap.royaltyBPS)} is set, to:
                    <Accounts accounts={collection.royalties.map(({ account, bps }) => ({ account, share: formatBPS(bps) }))} />
                    {cap.royaltyEnforcement === "listed_markets"
                        ? "That a listed market pays it is the creator's word: the ledger cannot check it."
                        : "The ledger states it for markets to pay on a sale. A direct transfer between holders pays none."}
                </>}
            </li>
            <li>{cap.holderBurn ? "A holder can burn their token." : "Holders cannot burn tokens."}</li>
            <li>{cap.creatorRevoke ? "The creator can revoke any token." : "The creator cannot revoke tokens."}</li>
            <li>
                {collection.sealed ? `Minting has ended for good, at ${count(collection.minted, "token", "tokens")}.`
                    : cap.maxSupply === 0n ? `No supply cap: the creator can keep minting (${collection.minted} so far).`
                    : `At most ${count(cap.maxSupply, "token", "tokens")} can ever be minted (${collection.minted} so far).`}
            </li>
            <li>{metadataLine(cap, collection.metadataRevision)}</li>
            <li>{cap.traitsCommitted ? <>Token traits are committed on chain: <span className="os-mono os-break">{collection.traitsRoot}</span></> : "No token traits are committed on chain."}</li>
        </ul>
    )
}

export function Passport({ screen, collection }: { screen: NftScreen; collection: NftCollection }) {
    const capabilities = useQuery({
        queryKey: ["nft", "ledger", "capabilities", screen.chainId, collection.id],
        queryFn: () => getCapabilities(collection.id),
        staleTime: 60_000, retry: false,
    })
    return (
        <section aria-label="Collection Passport" className="os-card">
            <h3 className="os-h">Collection Passport</h3>
            <p className="os-sub">What the ledger enforces for this collection.</p>
            {capabilities.isPending ? <Loading label="Reading what the ledger enforces…" />
                : capabilities.isError ? <ReadFailure error={capabilities.error} what="collection's terms" retry={() => void capabilities.refetch()} />
                : <Lines collection={collection} cap={capabilities.data} />}
        </section>
    )
}

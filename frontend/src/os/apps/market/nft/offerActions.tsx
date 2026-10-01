/**
 * The lane's offer controls: making a token or collection offer, the buyer
 * cancelling its own, and a token's holder accepting one. Each reads what its
 * sheet needs at the click; a guest is asked to connect only when it acts.
 *
 * @module os/apps/market/nft/offerActions
 */
import { useNow } from "../../../../hooks/home/useNow"
import { networkGasPriceFresh } from "../../../../lib/grc20"
import { formatAmount } from "../../../../lib/nft/format"
import { getLaneStatus, laneClosedReason } from "../../../../lib/nft/lane"
import type { NftOffer } from "../../../../lib/nft/market"
import { acceptBlocker, type MadeOfferKind } from "../../../../lib/nft/trade"
import type { OsSession } from "../../../shell/useOsSession"
import { ActionButton, OrderForm } from "./actions"
import { quoteOrder, useSignAction } from "./signing"
import { acceptOfferRequest, cancelOfferRequest, makeOfferRequest } from "./offerRequest"
import { isExpired, type LaneProps } from "./reads"

/** Escrow a price for one token (`number`) or for any token of the collection (`number` 0). */
export function MakeOfferForm({ lane, session, kind, collection, number }: { lane: LaneProps; session: OsSession; kind: MadeOfferKind; collection: string; number: bigint }) {
    const action = useSignAction(session)
    const submit = (price: bigint, expiresAt: bigint) => void action.run(async (caller) => {
        const quote = await quoteOrder(collection, price, "offer")
        return makeOfferRequest({
            kind, collection, number, price, expiresAt, feeBPS: quote.feeBPS, split: quote.split,
            caller, networkKey: session.network.key, chainId: lane.chainId, gas: quote.gas, onSettled: action.afterTrade,
        })
    })
    return (
        <OrderForm label={session.status === "member" ? "Make offer" : "Connect to make an offer"} action={action} submit={submit}>
            <p className="os-sub">The price is held by the market until the offer is accepted, cancelled or returned after it expires.</p>
        </OrderForm>
    )
}

/**
 * What the viewer can do with an offer: cancel its own, or, where `sell`
 * names a token it holds, sell that token to the offer. Nothing for anyone else.
 */
export function OfferAction({ lane, session, offer, sell }: {
    lane: LaneProps
    session: OsSession
    offer: NftOffer
    /** The viewer's token on this panel and its open listing, when the viewer holds it and it can be sold here. */
    sell: { number: bigint; listing: string | null } | null
}) {
    const action = useSignAction(session)
    const now = useNow(60_000)
    const viewer = session.status === "member" ? session.address : ""
    const common = { offer, networkKey: session.network.key, chainId: lane.chainId, onSettled: action.afterTrade }
    if (viewer !== "" && viewer === offer.buyer) {
        const cancel = () => void action.run(async (caller) => cancelOfferRequest({ ...common, caller, gas: await networkGasPriceFresh() }))
        return <ActionButton label="Cancel offer" quiet action={action} onClick={cancel} />
    }
    if (sell === null || isExpired(offer, now)) return null
    const blocker = acceptBlocker(offer, sell.number, viewer)
    if (blocker) return <p className="os-sub">{blocker}</p>
    const accept = () => void action.run(async (caller) => {
        const [gas, status] = await Promise.all([networkGasPriceFresh(), getLaneStatus("nft_market", offer.currency)])
        if (!status.open) throw new Error(laneClosedReason(status, "Trading"))
        return acceptOfferRequest({ ...common, caller, gas, number: sell.number, listing: sell.listing })
    })
    return <ActionButton label={`Sell for ${formatAmount(offer.price, offer.currency)}`} action={action} onClick={accept} />
}

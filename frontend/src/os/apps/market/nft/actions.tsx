/**
 * The lane's signing controls as shown: a button with the reason it could not
 * open below it, and the price and lifetime form of a new listing or offer.
 *
 * @module os/apps/market/nft/actions
 */
import { useState, type ReactNode } from "react"
import { LISTING_DAYS, listingExpiry, type ListingDays } from "../../../../lib/nft/trade"
import { parseGnot } from "../../../wallet/send"
import type { useSignAction } from "./signing"

export function ActionError({ error }: { error: string }) {
    return error ? <p className="os-note os-warn" role="alert">{error}</p> : null
}

/** One button that runs a signing control, with its reason below when it could not open. */
export function ActionButton({ label, quiet = false, action, onClick }: { label: string; quiet?: boolean; action: ReturnType<typeof useSignAction>; onClick: () => void }) {
    return (
        <div className="os-stack os-tight">
            <div className="os-row"><button type="button" className={quiet ? "os-btn os-quiet" : "os-btn"} disabled={action.busy} onClick={onClick}>{action.busy ? "Checking…" : label}</button></div>
            <ActionError error={action.error} />
        </div>
    )
}

/**
 * A price in GNOT and how long the order stays open. `submit` gets the
 * amount in ugnot and the expiry; a price that is not a plain positive GNOT
 * amount is refused here.
 */
export function OrderForm({ label, action, submit, children }: {
    label: string
    action: ReturnType<typeof useSignAction>
    submit: (price: bigint, expiresAt: bigint) => void
    children?: ReactNode
}) {
    const [price, setPrice] = useState("")
    const [days, setDays] = useState<ListingDays>(7)
    const go = () => {
        const amount = parseGnot(price)
        if (amount === null) { action.setError("Enter a price in GNOT, such as 12.5."); return }
        submit(amount, listingExpiry(Date.now() / 1000, days))
    }
    return (
        <div className="os-stack os-tight">
            <div className="os-row os-nft-field">
                <label className="os-row os-tight-row"><span>Price in GNOT</span><input inputMode="decimal" size={10} value={price} onChange={(event) => setPrice(event.target.value)} /></label>
                <label className="os-row os-tight-row"><span>Open for</span>
                    <select value={days} onChange={(event) => setDays(Number(event.target.value) as ListingDays)}>
                        {LISTING_DAYS.map((option) => <option key={option} value={option}>{option === 1 ? "1 day" : `${option} days`}</option>)}
                    </select>
                </label>
                <button type="button" className="os-btn" disabled={action.busy} onClick={go}>{action.busy ? "Checking…" : label}</button>
            </div>
            {children}
            <ActionError error={action.error} />
        </div>
    )
}

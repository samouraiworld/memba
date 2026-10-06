/** The notification-centre entry for the proposals waiting for this member's signature: it opens the Multisig app. */
import { awaitingText } from "./useOsMultisig"

export function AwaitingSignatures({ total, onOpen }: { total: number; onOpen: () => void }) {
    if (total === 0) return null
    return (
        <button type="button" className="os-nc os-nc-warn os-click" onClick={onOpen}>
            <span className="os-grow"><b>{awaitingText(total)}</b><span className="os-sub os-block">Open Multisig to review and sign.</span></span>
        </button>
    )
}

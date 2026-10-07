/**
 * The notification-centre entry for the proposals waiting for this member's
 * signature: it opens the Multisig app. Accounts not joined show only a count.
 */
import { awaitingText, sharedAwaitingText } from "../../lib/multisigAwaiting"
import type { Awaiting } from "./useOsMultisig"

export function AwaitingSignatures({ awaiting, onOpen }: { awaiting: Awaiting; onOpen: () => void }) {
    if (awaiting.mine + awaiting.shared === 0) return null
    return (
        <button type="button" className="os-nc os-nc-warn os-click" onClick={onOpen}>
            <span className="os-grow">
                {awaiting.mine > 0 && <b className="os-block">{awaitingText(awaiting.mine)}</b>}
                {awaiting.shared > 0 && <b className="os-block">{sharedAwaitingText(awaiting.shared)}</b>}
                <span className="os-sub os-block">Open Multisig to review and sign.</span>
            </span>
        </button>
    )
}

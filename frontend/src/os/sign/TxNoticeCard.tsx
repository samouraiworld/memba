/**
 * One signing notice in the notifications panel (desktop menu bar and phone
 * sheet). A notice about a transaction on a chain gnoscan indexes links to
 * that transaction there (the link's accessible name starts with its visible
 * text, then names the notice); anywhere else (no hash, a malformed one, or a chain
 * such as Onyx that gnoscan does not show) it stays plain text.
 *
 * @module os/sign/TxNoticeCard
 */
import { txExplorerUrl } from "../../lib/txExplorerUrl"
import type { TxNotice } from "./signerContext"

export function TxNoticeCard({ notice }: { notice: TxNotice }) {
    const href = notice.tx ? txExplorerUrl(notice.tx.hash, notice.tx.chainId) : null
    return (
        <div className={`os-nc os-nc-${notice.kind}${href ? " os-nc-tx" : ""}`}>
            <span className="os-grow">
                <b>{notice.title}</b>
                <span className="os-sub os-block">{notice.sub}</span>
                {href && (
                    <a className="os-nc-link" href={href} target="_blank" rel="noopener noreferrer">
                        View on Gnoscan{" "}<span className="os-nc-sr">(transaction: {notice.title}, opens in a new tab)</span> <span aria-hidden="true">↗</span>
                    </a>
                )}
                {/* A warning (outcome unknown, or not shown by the chain yet) may name a transaction
                    that has not landed: gnoscan has no page for it until it does. */}
                {href && notice.kind === "warn" && <span className="os-sub"> · it may not be listed there yet</span>}
            </span>
        </div>
    )
}

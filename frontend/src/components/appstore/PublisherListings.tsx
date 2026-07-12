import { Link } from "react-router-dom"
import { MAX_RESUBMITS } from "../../lib/appStoreSubmit"
import type { AppListing } from "../../lib/appStore"

const STATUS_LABEL: Record<string, string> = {
    pending: "Pending review",
    live: "Live",
    rejected: "Rejected",
    delisted: "Delisted",
}

export interface PublisherListingsProps {
    list: AppListing[]
    /** Network segment for the "view in store" link (e.g. "test13"). */
    networkKey: string
    /** Open the edit/resubmit flow for a listing. Async in practice; the parent drives it. */
    onResubmit: (l: AppListing) => void
    /** pkgPath whose edit form is currently loading (shows a spinner on that row's button). */
    editLoading: string | null
    delistArm: string | null
    delistError: string | null
    onArmDelist: (pkgPath: string | null) => void
    onConfirmDelist: (pkgPath: string) => void
    delisting: boolean
}

/**
 * PublisherListings — the caller's own App Store listings: status, curator reject reasons, the
 * remaining free edits (bounded by the realm's MaxResubmits), the community flag count, a link to
 * the live store page, and the free resubmit + one-way delist actions. Purely presentational —
 * every action is a prop callback, so both /apps/submit and the /apps/my-submissions console reuse
 * it without duplicating the delist/resubmit wiring.
 */
export function PublisherListings({
    list, networkKey, onResubmit, editLoading, delistArm, delistError, onArmDelist, onConfirmDelist, delisting,
}: PublisherListingsProps) {
    return (
        <ul className="appsubmit__minelist" data-testid="publisher-listings">
            {list.map((l) => {
                const editable = l.status === "rejected" || l.status === "pending"
                const editsLeft = MAX_RESUBMITS - (l.resubmitCount ?? 0)
                const loading = editLoading === l.pkgPath
                return (
                    <li key={l.pkgPath} className="appsubmit__mineitem">
                        <div className="appsubmit__minehead">
                            <span className="appsubmit__minename">{l.name}</span>
                            <span className={`appsubmit__status appsubmit__status--${l.status}`}>
                                {STATUS_LABEL[l.status] ?? l.status}
                            </span>
                            {l.flagCount > 0 && (
                                <span className="appsubmit__flags" data-testid="publisher-flags"
                                    title="Community reports">⚑ {l.flagCount}</span>
                            )}
                        </div>
                        <code className="apppath">{l.pkgPath}</code>

                        {l.status === "rejected" && (
                            <p className="appsubmit__reject">
                                Not approved{l.rejectReason ? <>: {l.rejectReason}</> : "."}
                            </p>
                        )}

                        {l.status === "live" && (
                            <Link className="appsubmit__viewlink" to={`/${networkKey}/apps/${l.pkgPath}`}>
                                View in store
                            </Link>
                        )}

                        {editable && (editsLeft > 0 ? (
                            <div className="appsubmit__editrow">
                                <button type="button" className="appbtn appbtn--ghost appsubmit__resubmit"
                                    disabled={loading} onClick={() => onResubmit(l)}>
                                    {loading ? "Loading…" : l.status === "rejected" ? "Fix & resubmit (free)" : "Edit listing"}
                                </button>
                                <span className="appsubmit__editsleft">{editsLeft} edits left</span>
                            </div>
                        ) : (
                            <p className="appsubmit__hint">Edit limit reached — ask a curator for help.</p>
                        ))}

                        {l.status === "live" && (
                            <p className="appsubmit__hint">
                                Live listings are locked for edits — ask a curator to unlock it for re-review.
                            </p>
                        )}

                        {l.status !== "delisted" && (delistArm === l.pkgPath ? (
                            <div className="appsubmit__delistconfirm" role="alert" data-testid="delist-confirm">
                                <p>
                                    Delisting is one-way for you: only a curator can restore it, and the
                                    package path stays taken. Remove “{l.name}” from the store?
                                </p>
                                <button type="button" className="appbtn appbtn--danger" disabled={delisting}
                                    onClick={() => onConfirmDelist(l.pkgPath)}>
                                    {delisting ? "Delisting…" : "Yes, delist"}
                                </button>
                                <button type="button" className="appbtn appbtn--ghost" disabled={delisting}
                                    onClick={() => onArmDelist(null)}>
                                    Keep it
                                </button>
                                {delistError && <p className="appsubmit__reject" role="alert">{delistError}</p>}
                            </div>
                        ) : (
                            <button type="button" className="appbtn appbtn--ghost appsubmit__delist"
                                onClick={() => onArmDelist(l.pkgPath)}>
                                Delist
                            </button>
                        ))}
                    </li>
                )
            })}
        </ul>
    )
}

/**
 * A collection's curation marks, and the notice that collapses what its
 * creator chose to show while curators hide it or its record cannot be read.
 *
 * @module os/apps/nft/curation
 */
import { ReadError } from "../../../lib/nft/read"
import { ErrorState, Loading, Pill } from "../../kit"
import type { CurationHide } from "./screen"

/** `collapsed` names what stays collapsed on this screen, e.g. "Its art and text". */
export function Curation({ hide, collapsed }: { hide: CurationHide; collapsed: string }) {
    const { record, revealed, reveal } = hide
    const showAnyway = !revealed && <button type="button" className="os-btn os-quiet" onClick={reveal}>Show anyway</button>
    if (record.isPending) return <Loading label="Reading curation…" />
    if (record.isError) {
        return <>
            <ErrorState message={`Curation could not be read. ${collapsed} stay collapsed until it is.`} onRetry={record.error instanceof ReadError ? () => void record.refetch() : undefined} />
            {showAnyway}
        </>
    }
    const { verified, featured, hidden } = record.data
    return <>
        <div className="os-row">
            {verified && <Pill tone="ok">Verified</Pill>}
            {featured && <Pill tone="ok">Featured</Pill>}
            {hidden && <Pill tone="warn">Hidden by curators</Pill>}
            {!verified && !featured && !hidden && <span className="os-sub">No curation mark.</span>}
        </div>
        {hidden && (
            <div className="os-note os-warn os-row" role="note">
                <span className="os-grow">Curators have hidden this collection for now. {revealed ? "You chose to show it." : `${collapsed} are collapsed.`}</span>
                {showAnyway}
            </div>
        )}
    </>
}

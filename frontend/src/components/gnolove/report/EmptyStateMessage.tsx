import type { ReportTab } from "../../../lib/gnoloveConstants"
import type { EmptyReason } from "./types"

interface Props {
    reason: EmptyReason
    selectedTeam: string
    selectedRepos: readonly string[]
    activeTab: ReportTab | "all"
    onClearTeam: () => void
    onClearRepos: () => void
    onClearTab: () => void
    onClearAll: () => void
}

export function EmptyStateMessage({
    reason, selectedTeam, selectedRepos, activeTab,
    onClearTeam, onClearRepos, onClearTab, onClearAll,
}: Props) {
    if (!reason || reason === "loading") {
        return <div className="gl-empty">No pull requests in this category for the selected period.</div>
    }
    if (reason === "no_data") {
        return (
            <div className="gl-empty">
                <p>No PR activity in this period.</p>
                <p className="gl-empty__hint">Try widening the period or selecting all repositories.</p>
                <button className="gl-empty__btn" onClick={onClearAll}>Reset filters</button>
            </div>
        )
    }
    if (reason === "team_and_repo") {
        return (
            <div className="gl-empty">
                <p><strong>{selectedTeam}</strong> didn&apos;t ship in <strong>{selectedRepos.join(", ")}</strong> during this period.</p>
                <div className="gl-empty__actions">
                    <button className="gl-empty__btn" onClick={onClearTeam}>Clear team</button>
                    <button className="gl-empty__btn" onClick={onClearRepos}>Clear repos</button>
                    <button className="gl-empty__btn" onClick={onClearAll}>Reset all</button>
                </div>
            </div>
        )
    }
    if (reason === "team") {
        return (
            <div className="gl-empty">
                <p>No PRs from <strong>{selectedTeam}</strong> in this period.</p>
                <button className="gl-empty__btn" onClick={onClearTeam}>Clear team filter</button>
            </div>
        )
    }
    if (reason === "repo") {
        return (
            <div className="gl-empty">
                <p>No PRs in <strong>{selectedRepos.join(", ")}</strong> for this period.</p>
                <button className="gl-empty__btn" onClick={onClearRepos}>Show all repositories</button>
            </div>
        )
    }
    return (
        <div className="gl-empty">
            <p>No PRs match <strong>{activeTab.replace(/_/g, " ")}</strong> in this period.</p>
            <button className="gl-empty__btn" onClick={onClearTab}>Show all statuses</button>
        </div>
    )
}

/**
 * TeamHubAIReportsCard — embed the most recent AI weekly report,
 * filtered to projects this team drove or contributed to.
 *
 * Phase 5 refactor: delegates rendering to the shared {@link AIReportCard}
 * component so the team-hub embed and the standalone /gnolove/ai-reports
 * page show the same short/long toggle, mobile sheet, and team filtering
 * behaviour. `compact` strips the per-card chrome (copy/download buttons)
 * since the standalone page is the export-friendly view.
 *
 * @module components/gnolove/teams/TeamHubAIReportsCard
 */

import { useSearchParams } from "react-router-dom"
import { useGnoloveAIReports } from "../../../hooks/gnolove"
import { AIReportCard } from "../AIReportCard"
import type { Team } from "../../../lib/gnoloveConstants"

interface Props {
    team: Team
}

export function TeamHubAIReportsCard({ team }: Props) {
    const { data: reports, isLoading } = useGnoloveAIReports()
    const [searchParams] = useSearchParams()
    const targetId = searchParams.get("aiReport")
    const matched = targetId && reports?.find(r => r.id === targetId)
    const latest = matched || reports?.[0]

    if (isLoading && !reports) {
        return (
            <div className="gl-thub-card" aria-busy="true">
                <h2 className="gl-thub-card-title">AI weekly report</h2>
                <div className="gl-thub-skel-airpt" aria-hidden="true">
                    <span className="gl-skeleton gl-thub-skel-airpt-summary" />
                    <span className="gl-skeleton gl-thub-skel-airpt-summary" />
                    <span className="gl-skeleton gl-thub-skel-airpt-toggle" />
                </div>
            </div>
        )
    }

    if (!latest) {
        return (
            <div className="gl-thub-card">
                <h2 className="gl-thub-card-title">AI weekly report</h2>
                <p className="gl-thub-empty">
                    No reports yet. The first one runs on the Sunday cron, or an
                    operator can trigger <code>/ai/report/regenerate</code> on demand.
                </p>
            </div>
        )
    }

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">AI weekly report</h2>
            <AIReportCard report={latest} teamSlug={team.slug} compact />
        </div>
    )
}

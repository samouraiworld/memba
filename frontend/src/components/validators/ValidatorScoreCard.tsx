/**
 * ValidatorScoreCard — gnomonitoring's 0-100 reliability score for ONE
 * validator, on that validator's own page, always beside what produced it.
 *
 * Why only here, and never as a ranking on the roster: the score is a blend
 * (sign rate, less penalties for alerts, downtime and incident FREQUENCY), and a
 * blend without its inputs invites the wrong conclusion. On gnoland-1's first
 * day every window carried identical inputs for our own validator — 98.6% sign
 * rate, 243 missed blocks, 27 warnings — yet scored 24 over 24 hours and 68 over
 * the year, because the same incidents per WEEK look far more frequent in a
 * short window. Shown bare, "24 Critical" reads as an outage; shown with
 * "27 · 189/week" beside it, it reads as what it is.
 *
 * The no-data rule comes from `validatorReports.ts`: a window without evidence
 * arrives upstream as score 0 / Critical, which is the absence of a measurement,
 * not a measurement of zero. Such a window says "No data", never a number.
 */
import { useId, useState } from "react"
import { formatPercent } from "../../lib/formatPercent"
import {
    REPORT_WINDOWS,
    type ReportWindow,
    type ValidatorReport,
    type ValidatorReportPeriod,
} from "../../lib/validatorReports"
import { useTabListKeyboard } from "../../hooks/useTabListKeyboard"

const WINDOWS: Record<ReportWindow, { tab: string; name: string; span: string }> = {
    last_24h: { tab: "24h", name: "Last 24 hours", span: "rolling" },
    current_week: { tab: "Week", name: "This week", span: "since Monday, UTC" },
    current_month: { tab: "Month", name: "This month", span: "since the 1st, UTC" },
    current_year: { tab: "Year", name: "This year", span: "since 1 January, UTC" },
}

/** Tone for known tiers only; an unrecognised upstream tier stays untoned. */
function tierTone(tier: string): "ok" | "warn" | "bad" | null {
    switch (tier) {
        case "Excellent":
        case "Good":
            return "ok"
        case "Watch":
            return "warn"
        case "Critical":
            return "bad"
        default:
            return null
    }
}

function scored(p: ValidatorReportPeriod | null): p is ValidatorReportPeriod {
    return p != null && p.hasData
}

function plural(n: number, one: string, many: string): string {
    return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** 189 → "189", 15.12 → "15", 2.155 → "2.2", 0.7397 → "0.7". */
function formatRate(n: number): string {
    return n >= 10 ? String(Math.round(n)) : String(Number(n.toFixed(1)))
}

function lastAlert(days: number | null): string | null {
    if (days == null) return null
    if (days === 0) return "Last alert today"
    return `Last alert ${plural(days, "day", "days")} ago`
}

function Shell({ titleId, children }: { titleId: string; children: React.ReactNode }) {
    return (
        <section className="vd-card vd-score" aria-labelledby={titleId} data-testid="vd-score">
            <div className="vd-card__title" id={titleId}>
                <span aria-hidden="true">🎯 </span>Reliability score
            </div>
            {children}
        </section>
    )
}

function Drivers({ p }: { p: ValidatorReportPeriod }) {
    const rows: Array<[string, string]> = [
        ["Sign rate", formatPercent(p.signRate)],
        ["Missed blocks", p.missedBlocks.toLocaleString()],
        ["Downtime", plural(p.downtimeBlocks, "block", "blocks")],
        ["Incidents", p.incidentCount === 0
            ? "0"
            : `${p.incidentCount.toLocaleString()} · ${formatRate(p.incidentRatePerWeek)}/week`],
        ["Alerts", `${p.criticalCount.toLocaleString()} critical · ${plural(p.warningCount, "warning", "warnings")}`],
    ]
    if (p.proposerReliability != null) rows.push(["Proposals", `${formatPercent(p.proposerReliability)} of expected`])
    return (
        <dl className="vd-score-drivers">
            {rows.map(([label, value]) => (
                <div key={label} className="vd-score-driver">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    )
}

export function ValidatorScoreCard({
    address,
    reports,
    loading,
}: {
    /** Bech32 address; the report map is keyed lowercase. */
    address: string
    /** undefined while unfetched, null when monitoring could not be asked. */
    reports: Map<string, ValidatorReport> | null | undefined
    loading: boolean
}) {
    const baseId = useId()
    const titleId = `${baseId}-title`
    const [picked, setPicked] = useState<ReportWindow | null>(null)

    const report = reports?.get(address.toLowerCase())
    // Open on the most recent window that has something to say.
    const active = picked ?? REPORT_WINDOWS.find((w) => scored(report?.periods[w] ?? null)) ?? REPORT_WINDOWS[0]

    const { tabProps } = useTabListKeyboard<ReportWindow>({
        keys: REPORT_WINDOWS,
        active,
        onSelect: setPicked,
        idFor: (w) => `${baseId}-tab-${w}`,
    })

    if (loading) {
        return <Shell titleId={titleId}><p className="vd-score__status">Loading score…</p></Shell>
    }
    if (!reports) {
        return <Shell titleId={titleId}><p className="vd-score__status">Score unavailable right now.</p></Shell>
    }
    if (!report || !report.hasData) {
        return (
            <Shell titleId={titleId}>
                <p className="vd-score__status">Not scored yet — monitoring has no signing record for this validator.</p>
            </Shell>
        )
    }

    const current = report.periods[active]
    const alert = lastAlert(report.daysSinceLastAlert)

    return (
        <Shell titleId={titleId}>
            <p className="vd-score__intro">
                Scored 0–100 by gnomonitoring: the sign rate, minus penalties for alerts, downtime and how
                often incidents happen — so the same incidents weigh more in a shorter window.
                {" "}Excellent 85+ · Good 60+ · Watch 30+ · Critical below 30.
            </p>
            {alert && <p className="vd-score__meta">{alert}</p>}

            <div className="vd-score-tabs" role="tablist" aria-label="Score window">
                {REPORT_WINDOWS.map((w) => {
                    const p = report.periods[w]
                    const meta = WINDOWS[w]
                    const has = scored(p)
                    const tone = has ? tierTone(p.tier) : null
                    return (
                        <button
                            key={w}
                            type="button"
                            {...tabProps(w)}
                            aria-controls={`${baseId}-panel`}
                            aria-label={has ? `${meta.name}: ${p.score} out of 100, ${p.tier}` : `${meta.name}: no data`}
                            className={`vd-score-tab${tone ? ` vd-score-tab--${tone}` : ""}${has ? "" : " vd-score-tab--nodata"}`}
                            onClick={() => setPicked(w)}
                        >
                            <span className="vd-score-tab__label">{meta.tab}</span>
                            <span className="vd-score-tab__score">{has ? p.score : "—"}</span>
                            <span className="vd-score-tab__tier">{has ? p.tier : "No data"}</span>
                        </button>
                    )
                })}
            </div>

            <div
                className="vd-score-panel"
                role="tabpanel"
                id={`${baseId}-panel`}
                aria-labelledby={`${baseId}-tab-${active}`}
            >
                <p className="vd-score-panel__window">{WINDOWS[active].name} · {WINDOWS[active].span}</p>
                {scored(current) ? (
                    <Drivers p={current} />
                ) : (
                    <p className="vd-score__status">
                        No monitoring data for this window. That is missing data, not a score of zero.
                    </p>
                )}
            </div>
        </Shell>
    )
}

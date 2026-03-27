/**
 * ReportScheduleForm — Daily report time configuration.
 *
 * Lets users set when they receive their daily validator monitoring report.
 * Auto-detects browser timezone, allows manual override.
 *
 * @module components/alerts/ReportScheduleForm
 */

import { useState } from "react"
import type { ReportSchedule } from "../../lib/monitoringAuth"

interface Props {
    schedule: ReportSchedule | null
    onSave: (hour: number, minute: number, timezone: string) => Promise<boolean>
}

const COMMON_TIMEZONES = [
    "Europe/Paris", "Europe/London", "Europe/Berlin", "Europe/Moscow",
    "America/New_York", "America/Chicago", "America/Los_Angeles",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "Asia/Kolkata",
    "Australia/Sydney", "Pacific/Auckland",
    "UTC",
]

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.3)", color: "#f0f0f0",
    fontFamily: "JetBrains Mono, monospace", fontSize: 12,
    boxSizing: "border-box", cursor: "pointer",
}

const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "#888",
    fontFamily: "JetBrains Mono, monospace",
    display: "block", marginBottom: 4,
}

const btnStyle: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 8, border: "none",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
    fontSize: 12, fontWeight: 600,
}

function detectTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    } catch {
        return "UTC"
    }
}

export function ReportScheduleForm({ schedule, onSave }: Props) {
    // Derive initial values from schedule prop (only used on first render)
    const initHour = schedule?.daily_report_hour ?? 9
    const initMinute = schedule?.daily_report_minute ?? 0
    const initTz = schedule?.Timezone || detectTimezone()

    const [hour, setHour] = useState(initHour)
    const [minute, setMinute] = useState(initMinute)
    const [timezone, setTimezone] = useState(initTz)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        setSaved(false)
        const ok = await onSave(hour, minute, timezone)
        setSaving(false)
        if (ok) {
            setSaved(true)
            setTimeout(() => setSaved(false), 3000)
        }
    }

    const pad = (n: number) => String(n).padStart(2, "0")

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 12 }}>
                {/* Hour */}
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Hour</label>
                    <select id="report-hour" value={hour} onChange={e => setHour(Number(e.target.value))} style={inputStyle}>
                        {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{pad(i)}</option>
                        ))}
                    </select>
                </div>
                {/* Minute */}
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Minute</label>
                    <select id="report-minute" value={minute} onChange={e => setMinute(Number(e.target.value))} style={inputStyle}>
                        {[0, 15, 30, 45].map(m => (
                            <option key={m} value={m}>{pad(m)}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Timezone */}
            <div>
                <label style={labelStyle}>Timezone</label>
                <select id="report-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} style={inputStyle}>
                    {COMMON_TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                    ))}
                </select>
            </div>

            {/* Preview */}
            <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "rgba(0,212,170,0.04)",
                border: "1px solid rgba(0,212,170,0.1)",
                fontSize: 11, color: "#00d4aa",
                fontFamily: "JetBrains Mono, monospace",
            }}>
                📋 Daily report at <strong>{pad(hour)}:{pad(minute)}</strong> {timezone}
            </div>

            {/* Save */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        ...btnStyle,
                        background: saving ? "rgba(0,212,170,0.08)" : "#00d4aa",
                        color: saving ? "#00d4aa" : "#000",
                    }}
                >
                    {saving ? "Saving…" : "Save Schedule"}
                </button>
                {saved && (
                    <span style={{ fontSize: 11, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace" }}>
                        ✓ Saved
                    </span>
                )}
            </div>
        </div>
    )
}

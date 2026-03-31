/**
 * Payroll Plugin — Batch payment distribution for operational DAOs.
 *
 * Sprint 7: Allows DAO admins to create payroll proposals that
 * distribute funds to multiple recipients in a single governance action.
 *
 * Features:
 * - Multi-recipient form with add/remove rows
 * - CSV import (address,amount,role)
 * - Batch MsgSend proposal generation
 * - Recurring template persistence (localStorage)
 */

import { useState, useCallback } from "react"
import type { PluginProps } from "../types"
import {
    type PayrollRecipient,
    parsePayrollCSV,
    calculatePayrollTotal,
    isValidRecipient,
    MAX_PAYROLL_RECIPIENTS,
} from "./types"
import { buildPayrollProposal } from "./builders"
import "./payroll.css"

export default function PayrollView({ realmPath, auth }: PluginProps) {
    const [recipients, setRecipients] = useState<PayrollRecipient[]>([
        { address: "", amount: 0n, role: "member", startBlock: 0 },
    ])
    const [period, setPeriod] = useState("")
    const [csvMode, setCsvMode] = useState(false)
    const [csvText, setCsvText] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [preview, setPreview] = useState<ReturnType<typeof buildPayrollProposal> | null>(null)

    // ── Template persistence ─────────────────────────────────
    const TEMPLATE_KEY = `memba_payroll_${realmPath}`

    const saveTemplate = useCallback(() => {
        try {
            const valid = recipients.filter(r => r.address && r.amount > 0n)
            if (valid.length > 0) {
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(
                    valid.map(r => ({ ...r, amount: String(r.amount) })),
                ))
            }
        } catch { /* */ }
    }, [recipients, TEMPLATE_KEY])

    const loadTemplate = useCallback(() => {
        try {
            const raw = localStorage.getItem(TEMPLATE_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw) as Array<{ address: string; amount: string; role: string; startBlock: number }>
            setRecipients(parsed.map(r => ({ ...r, amount: BigInt(r.amount) })))
        } catch { /* */ }
    }, [TEMPLATE_KEY])

    // ── Recipient management ─────────────────────────────────

    const addRecipient = () => {
        if (recipients.length >= MAX_PAYROLL_RECIPIENTS) {
            setError(`Maximum ${MAX_PAYROLL_RECIPIENTS} recipients per batch.`)
            return
        }
        setRecipients([...recipients, { address: "", amount: 0n, role: "member", startBlock: 0 }])
    }

    const removeRecipient = (index: number) => {
        setRecipients(recipients.filter((_, i) => i !== index))
    }

    const updateRecipient = (index: number, field: keyof PayrollRecipient, value: string) => {
        const updated = [...recipients]
        if (field === "amount") {
            try { updated[index] = { ...updated[index], amount: BigInt(value || "0") } } catch { /* */ }
        } else {
            updated[index] = { ...updated[index], [field]: value }
        }
        setRecipients(updated)
    }

    // ── CSV import ───────────────────────────────────────────

    const importCSV = () => {
        const parsed = parsePayrollCSV(csvText)
        if (parsed.length === 0) {
            setError("No valid recipients found in CSV. Expected format: address,amount[,role]")
            return
        }
        if (parsed.length > MAX_PAYROLL_RECIPIENTS) {
            setError(`CSV contains ${parsed.length} recipients. Maximum is ${MAX_PAYROLL_RECIPIENTS}.`)
            return
        }
        setRecipients(parsed)
        setCsvMode(false)
        setError(null)
    }

    // ── Preview proposal ─────────────────────────────────────

    const generatePreview = () => {
        const valid = recipients.filter(r => isValidRecipient(r))
        if (valid.length === 0) {
            setError("No valid recipients. Each needs a g1... address and amount > 0.")
            return
        }
        setError(null)
        setPreview(buildPayrollProposal(valid, auth.address || "", period || undefined))
        saveTemplate()
    }

    // ── Render ───────────────────────────────────────────────

    const validCount = recipients.filter(r => r.address.startsWith("g1") && r.amount > 0n).length
    const total = calculatePayrollTotal(recipients.filter(r => r.amount > 0n))

    return (
        <div className="pay-page">
            <div className="pay-header">
                <h2 className="pay-header__title">Payroll</h2>
                <p className="pay-header__subtitle">Batch payment distribution for {realmPath.split("/").pop()}</p>
            </div>

            {/* Template actions */}
            <div className="pay-actions">
                <button className="pay-btn pay-btn--secondary" onClick={loadTemplate}>Load Template</button>
                <button className="pay-btn pay-btn--secondary" onClick={() => setCsvMode(!csvMode)}>
                    {csvMode ? "Manual Entry" : "CSV Import"}
                </button>
            </div>

            {error && <div className="pay-error">{error}</div>}

            {/* Preview */}
            {preview && (
                <div className="pay-preview">
                    <h3>{preview.title}</h3>
                    <p className="pay-preview__total">
                        Total: {(Number(preview.totalAmount) / 1_000_000).toFixed(2)} GNOT
                        ({preview.recipients.length} recipients)
                    </p>
                    <div className="pay-preview__list">
                        {preview.recipients.map((r, i) => (
                            <div key={i} className="pay-preview__row">
                                <span className="pay-preview__addr">{r.address.slice(0, 10)}...{r.address.slice(-6)}</span>
                                <span className="pay-preview__role">{r.role}</span>
                                <span className="pay-preview__amount">{(Number(r.amount) / 1_000_000).toFixed(2)} GNOT</span>
                            </div>
                        ))}
                    </div>
                    <button className="pay-btn pay-btn--primary" onClick={() => setPreview(null)}>Edit</button>
                </div>
            )}

            {/* CSV Mode */}
            {!preview && csvMode && (
                <div className="pay-csv">
                    <label className="pay-label">Paste CSV (address,amount,role)</label>
                    <textarea
                        className="pay-csv__input"
                        value={csvText}
                        onChange={e => setCsvText(e.target.value)}
                        placeholder={`# address, amount (ugnot), role
g1alice..., 1000000, engineer
g1bob..., 2000000, designer`}
                        rows={8}
                    />
                    <button className="pay-btn pay-btn--primary" onClick={importCSV}>Import</button>
                </div>
            )}

            {/* Manual entry */}
            {!preview && !csvMode && (
                <>
                    <div className="pay-period">
                        <label className="pay-label">Period (optional)</label>
                        <input
                            className="pay-input"
                            value={period}
                            onChange={e => setPeriod(e.target.value)}
                            placeholder="e.g. March 2026"
                        />
                    </div>

                    <div className="pay-recipients">
                        {recipients.map((r, i) => (
                            <div key={i} className="pay-row">
                                <input
                                    className="pay-input pay-input--addr"
                                    value={r.address}
                                    onChange={e => updateRecipient(i, "address", e.target.value)}
                                    placeholder="g1..."
                                />
                                <input
                                    className="pay-input pay-input--amount"
                                    value={r.amount > 0n ? String(r.amount) : ""}
                                    onChange={e => updateRecipient(i, "amount", e.target.value.replace(/[^0-9]/g, ""))}
                                    placeholder="ugnot"
                                />
                                <input
                                    className="pay-input pay-input--role"
                                    value={r.role}
                                    onChange={e => updateRecipient(i, "role", e.target.value)}
                                    placeholder="role"
                                />
                                {recipients.length > 1 && (
                                    <button className="pay-remove" onClick={() => removeRecipient(i)} title="Remove">×</button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="pay-footer">
                        <button className="pay-btn pay-btn--secondary" onClick={addRecipient}>+ Add Recipient</button>
                        <div className="pay-footer__summary">
                            <span>{validCount} valid / {recipients.length} total</span>
                            <span>{(Number(total) / 1_000_000).toFixed(2)} GNOT</span>
                        </div>
                        <button
                            className="pay-btn pay-btn--primary"
                            onClick={generatePreview}
                            disabled={validCount === 0}
                        >
                            Generate Proposal
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}

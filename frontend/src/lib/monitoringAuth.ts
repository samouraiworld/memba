/**
 * monitoringAuth.ts — Authenticated API client for gnomonitoring protected endpoints.
 *
 * Mirrors the pattern from gnomonitoring.ts (public metrics) but adds:
 * - Authorization: Bearer <token> header (Clerk JWT)
 * - No caching (webhook data is mutable, must always be fresh)
 * - 8s timeout with AbortSignal
 * - Graceful null return on failure
 *
 * All endpoints are per-user (user ID extracted from JWT server-side).
 *
 * @module lib/monitoringAuth
 */

import { GNO_MONITORING_API_URL, GNO_CHAIN_ID } from "./config"

// ── Types ────────────────────────────────────────────────────

export type WebhookKind = "govdao" | "validator"
export type WebhookType = "discord" | "slack"

export interface MonitoringWebhook {
    ID: number
    Description: string
    URL: string
    Type: WebhookType
    ChainID?: string | null
}

export interface AlertContact {
    ID: number
    Moniker: string
    NameContact: string
    MentionTag: string
    IDwebhook: number
}

export interface ReportSchedule {
    daily_report_hour: number
    daily_report_minute: number
    Timezone: string
}

// ── Internal helpers ─────────────────────────────────────────

/** Authenticated fetch wrapper with timeout and error handling. */
async function authFetch<T>(
    path: string,
    token: string,
    options?: RequestInit,
): Promise<T | null> {
    if (!GNO_MONITORING_API_URL) return null

    try {
        const url = `${GNO_MONITORING_API_URL}${path}`
        const res = await fetch(url, {
            ...options,
            headers: {
                ...options?.headers,
                Authorization: `Bearer ${token}`,
            },
            signal: options?.signal ?? AbortSignal.timeout(8000),
        })

        if (!res.ok) {
            if (res.status === 401) console.warn("[monitoringAuth] Unauthorized — token may be expired")
            return null
        }

        // DELETE/PUT may return no body
        const text = await res.text()
        if (!text) return null as T
        return JSON.parse(text) as T
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null
        console.warn(`[monitoringAuth] ${path} failed:`, err)
        return null
    }
}

/** Append chain query parameter to a path. */
function withChain(path: string, chain?: string): string {
    const chainId = chain || GNO_CHAIN_ID
    const sep = path.includes("?") ? "&" : "?"
    return `${path}${sep}chain=${encodeURIComponent(chainId)}`
}

// ── Webhooks (GovDAO + Validator) ────────────────────────────

export async function listWebhooks(
    token: string,
    kind: WebhookKind,
    chain?: string,
): Promise<MonitoringWebhook[]> {
    const data = await authFetch<MonitoringWebhook[]>(
        withChain(`/webhooks/${kind}`, chain),
        token,
    )
    return data || []
}

export async function createWebhook(
    token: string,
    kind: WebhookKind,
    payload: Omit<MonitoringWebhook, "ID">,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/webhooks/${kind}`
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn(`[monitoringAuth] createWebhook(${kind}) failed:`, err)
        return false
    }
}

export async function updateWebhook(
    token: string,
    kind: WebhookKind,
    payload: MonitoringWebhook,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/webhooks/${kind}`
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn(`[monitoringAuth] updateWebhook(${kind}) failed:`, err)
        return false
    }
}

export async function deleteWebhook(
    token: string,
    kind: WebhookKind,
    id: number,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/webhooks/${kind}?id=${encodeURIComponent(String(id))}`
        const res = await fetch(url, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn(`[monitoringAuth] deleteWebhook(${kind}, ${id}) failed:`, err)
        return false
    }
}

// ── Alert Contacts ───────────────────────────────────────────

export async function listAlertContacts(token: string): Promise<AlertContact[]> {
    const data = await authFetch<AlertContact[]>("/alert-contacts", token)
    return data || []
}

export async function createAlertContact(
    token: string,
    payload: Omit<AlertContact, "ID">,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/alert-contacts`
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn("[monitoringAuth] createAlertContact failed:", err)
        return false
    }
}

export async function updateAlertContact(
    token: string,
    payload: AlertContact,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/alert-contacts`
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn("[monitoringAuth] updateAlertContact failed:", err)
        return false
    }
}

export async function deleteAlertContact(
    token: string,
    id: number,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/alert-contacts?id=${encodeURIComponent(String(id))}`
        const res = await fetch(url, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn("[monitoringAuth] deleteAlertContact failed:", err)
        return false
    }
}

// ── Daily Report Schedule ────────────────────────────────────

export async function getReportSchedule(token: string): Promise<ReportSchedule | null> {
    return authFetch<ReportSchedule>("/usersH", token)
}

export async function updateReportSchedule(
    token: string,
    hour: number,
    minute: number,
    timezone: string,
): Promise<boolean> {
    if (!GNO_MONITORING_API_URL) return false

    try {
        const url = `${GNO_MONITORING_API_URL}/usersH`
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ hour, minute, timezone }),
            signal: AbortSignal.timeout(8000),
        })
        return res.ok
    } catch (err) {
        console.warn("[monitoringAuth] updateReportSchedule failed:", err)
        return false
    }
}

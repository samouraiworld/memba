/**
 * monitoringAuth.ts — Authenticated API client for gnomonitoring protected endpoints.
 *
 * Mirrors the pattern from gnomonitoring.ts (public metrics) but adds:
 * - Authorization: Bearer <token> header (Clerk JWT)
 * - No caching (webhook data is mutable, must always be fresh)
 * - 8s timeout with AbortSignal
 * - Graceful null return on failure
 * - Webhook mutations (create/update) return a `MutationResult { ok, error? }`
 *   instead of a bare boolean, so the server's refusal reason survives to the UI
 *
 * All endpoints are per-user (user ID extracted from JWT server-side).
 *
 * @module lib/monitoringAuth
 */

import { GNO_MONITORING_API_URL } from "./config"

// ── Types ────────────────────────────────────────────────────

export type WebhookKind = "govdao" | "validator"
export type WebhookType = "discord" | "slack"

/** Domain model used by the UI. NOT the wire format — see toWire/fromWire. */
export interface MonitoringWebhook {
    ID: number
    Description: string
    URL: string
    Type: WebhookType
    ChainID?: string | null
}

/** A webhook as submitted by the form: no ID when creating, ID when editing. */
export type WebhookInput = Omit<MonitoringWebhook, "ID"> & { ID?: number }

/** Outcome of a mutating call, carrying the server's explanation on refusal. */
export interface MutationResult {
    ok: boolean
    error?: string
}

/**
 * gnomonitoring's JSON shape for a webhook.
 *
 * Server-side, ChainID is the ONLY field with a JSON tag (`json:"chain_id"`).
 * The rest are untagged, so Go matches them case-insensitively against the Go
 * field name — which is why the PascalCase keys here are correct and must not
 * be "normalised" to snake_case.
 */
interface WebhookRow {
    ID: number
    Description: string
    URL: string
    Type: WebhookType
    chain_id?: string | null
}

/** Domain → wire. Omits chain_id entirely when unset: the server rejects an
 *  empty/null value ("chain_id is required") but reads an ABSENT one on PUT as
 *  "leave the stored chain untouched". */
function toWire(w: WebhookInput): Record<string, unknown> {
    const wire: Record<string, unknown> = {
        URL: w.URL,
        Type: w.Type,
        Description: w.Description,
    }
    if (w.ID != null) wire.ID = w.ID
    if (w.ChainID) wire.chain_id = w.ChainID
    return wire
}

/** Wire → domain. */
function fromWire(row: WebhookRow): MonitoringWebhook {
    return {
        ID: row.ID,
        Description: row.Description,
        URL: row.URL,
        Type: row.Type,
        ChainID: row.chain_id ?? null,
    }
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

// ── Webhooks (GovDAO + Validator) ────────────────────────────

/**
 * All of the user's webhooks of this kind, across every chain.
 *
 * Deliberately UNSCOPED. The server accepts an optional `?chain=` filter, but
 * the chain selector offers every chain gnomonitoring accepts — which is not
 * the same set as Memba's own networks. Filtering here would hide any webhook
 * scoped to another chain, leaving it created-but-unreachable. The per-card
 * chain badge is what tells them apart.
 */
export async function listWebhooks(
    token: string,
    kind: WebhookKind,
): Promise<MonitoringWebhook[]> {
    const data = await authFetch<WebhookRow[] | { message: string }>(
        `/webhooks/${kind}`,
        token,
    )
    // With zero webhooks the server returns {"message":"no webhook found"} —
    // an object, not an array. Never let that shape reach the UI.
    if (!Array.isArray(data)) return []
    return data.map(fromWire)
}

/**
 * POST/PUT a webhook, preserving the server's explanation on refusal.
 *
 * gnomonitoring answers refusals with a plain-text body ("chain_id is
 * required", "webhook URL host ... is not allowed for type ..."). Collapsing
 * that to a boolean is what made this class of bug undiagnosable from the UI.
 */
async function mutateWebhook(
    token: string,
    kind: WebhookKind,
    method: "POST" | "PUT",
    payload: WebhookInput,
): Promise<MutationResult> {
    if (!GNO_MONITORING_API_URL) {
        return { ok: false, error: "Monitoring API is not configured" }
    }

    try {
        const res = await fetch(`${GNO_MONITORING_API_URL}/webhooks/${kind}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(toWire(payload)),
            signal: AbortSignal.timeout(8000),
        })

        if (res.ok) return { ok: true }

        const detail = (await res.text()).trim().slice(0, 200)
        return { ok: false, error: detail || `Request failed (HTTP ${res.status})` }
    } catch (err) {
        console.warn(`[monitoringAuth] ${method} /webhooks/${kind} failed:`, err)
        return { ok: false, error: "Network error — please try again" }
    }
}

export function createWebhook(
    token: string,
    kind: WebhookKind,
    payload: WebhookInput & { ChainID: string },
): Promise<MutationResult> {
    return mutateWebhook(token, kind, "POST", payload)
}

export function updateWebhook(
    token: string,
    kind: WebhookKind,
    payload: WebhookInput & { ID: number },
): Promise<MutationResult> {
    return mutateWebhook(token, kind, "PUT", payload)
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

/**
 * Domain → wire for an alert contact.
 *
 * Asymmetric with the read shape on purpose. `GET /alert-contacts` returns
 * gnomonitoring's GORM model, which carries no JSON tags and therefore comes
 * back PascalCase — which is why the `AlertContact` interface above is right
 * for reading and must not be "normalised". The POST/PUT handlers decode into
 * a DIFFERENT struct whose tags are snake_case (`mention_tag`, `id_webhook`).
 *
 * Go's decoder only falls back to case-insensitive matching when no tag
 * matches exactly, and that fallback ignores case, not underscores. So
 * `Moniker`→`moniker` matched, but `MentionTag`→`mention_tag` did not:
 * every contact created from this form was stored with an empty tag and
 * `id_webhook = 0`, answered 201, and could never fire a mention.
 */
function toContactWire(c: Omit<AlertContact, "ID"> & { ID?: number }): Record<string, unknown> {
    const wire: Record<string, unknown> = {
        moniker: c.Moniker,
        namecontact: c.NameContact,
        mention_tag: c.MentionTag,
        id_webhook: c.IDwebhook,
    }
    if (c.ID != null) wire.id = c.ID
    return wire
}

/**
 * POST/PUT an alert contact, preserving the server's explanation on refusal.
 *
 * The hardened endpoints refuse far more than they used to — unowned webhook,
 * blank required fields, non-numeric tag, unknown contact, and a payload that
 * would unlink a contact from its webhook. Collapsing all of that to a boolean
 * would replace one silent no-op with another.
 */
async function mutateAlertContact(
    token: string,
    method: "POST" | "PUT",
    payload: Omit<AlertContact, "ID"> & { ID?: number },
): Promise<MutationResult> {
    if (!GNO_MONITORING_API_URL) {
        return { ok: false, error: "Monitoring API is not configured" }
    }

    try {
        const res = await fetch(`${GNO_MONITORING_API_URL}/alert-contacts`, {
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(toContactWire(payload)),
            signal: AbortSignal.timeout(8000),
        })

        if (res.ok) return { ok: true }

        const detail = (await res.text()).trim().slice(0, 200)
        return { ok: false, error: detail || `Request failed (HTTP ${res.status})` }
    } catch (err) {
        console.warn(`[monitoringAuth] ${method} /alert-contacts failed:`, err)
        return { ok: false, error: "Network error — please try again" }
    }
}

export function createAlertContact(
    token: string,
    payload: Omit<AlertContact, "ID">,
): Promise<MutationResult> {
    return mutateAlertContact(token, "POST", payload)
}

export function updateAlertContact(
    token: string,
    payload: AlertContact,
): Promise<MutationResult> {
    return mutateAlertContact(token, "PUT", payload)
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

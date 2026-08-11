/**
 * webhookForm.ts — pure derivation and validation rules for the webhook form.
 *
 * Kept out of the component so the rules are unit-testable, and out of
 * config.ts because they key off gnomonitoring's chain registry rather than
 * Memba's NETWORKS map.
 *
 * @module lib/webhookForm
 */

import { NETWORKS } from "./config"
import type { WebhookType } from "./monitoringAuth"

export interface ChainOption {
    value: string
    label: string
}

/**
 * Options for the webhook chain <select>.
 *
 * `enabled` comes from gnomonitoring /info. `current` — the chain already
 * stored on the webhook being edited — ALWAYS gets an option, even when the
 * service no longer offers it: a <select> whose value matches no option renders
 * blank (selectedIndex -1) while state keeps resubmitting the old value, so the
 * user can neither see nor correct what it is scoped to.
 *
 * Labels borrow Memba's network name when the id is one we model, purely for
 * readability — the VALUE is always the service's own id.
 */
export function chainOptionsFor(
    enabled: string[],
    current?: string | null,
): ChainOption[] {
    const labelFor = (chainId: string): string => {
        const net = Object.values(NETWORKS).find(n => n.chainId === chainId)
        return net ? `${net.label} (${chainId})` : chainId
    }

    const options = enabled.map(chainId => ({
        value: chainId,
        label: labelFor(chainId),
    }))

    if (current && !options.some(o => o.value === current)) {
        options.unshift({ value: current, label: `${current} — no longer offered` })
    }

    return options
}

/**
 * Webhook hosts gnomonitoring accepts, per type. Mirrors `allowedWebhookHosts`
 * in the server's api.go: anything else is refused with a 400, so accepting a
 * wider set here only converts a fixable form error into an opaque late
 * failure.
 */
const ALLOWED_WEBHOOK_HOSTS: Record<WebhookType, string[]> = {
    discord: ["discord.com", "discordapp.com"],
    slack: ["hooks.slack.com"],
}

/** Returns an error message, or null when the URL is acceptable. */
export function validateWebhookUrl(type: WebhookType, raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return "URL is required"

    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return "Must be a valid URL"
    }

    if (parsed.protocol !== "https:") return "Webhook URL must use https"

    const hosts = ALLOWED_WEBHOOK_HOSTS[type]
    if (!hosts.includes(parsed.hostname.toLowerCase())) {
        return `${type} webhooks must be hosted on ${hosts.join(" or ")}`
    }

    return null
}

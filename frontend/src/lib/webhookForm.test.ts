/**
 * Pure form rules for webhooks.
 *
 * The chain selector must never render blank: a <select> whose value matches
 * no option shows selectedIndex -1 while state keeps resubmitting the old
 * value — invisible and uncorrectable. That invariant used to live against
 * Memba's NETWORKS map; it matters MORE now that the option list comes from a
 * separate registry that can drop a chain at any time.
 */
import { describe, it, expect } from "vitest"
import { chainOptionsFor, validateWebhookUrl } from "./webhookForm"

describe("chainOptionsFor", () => {
    const enabled = ["gnoland1", "gnoland-1", "onyx-1"]

    it("offers exactly the enabled chains when the current value is among them", () => {
        const options = chainOptionsFor(enabled, "onyx-1")
        expect(options.map(o => o.value)).toEqual(enabled)
    })

    it("offers exactly the enabled chains when there is no current value", () => {
        expect(chainOptionsFor(enabled).map(o => o.value)).toEqual(enabled)
        expect(chainOptionsFor(enabled, null).map(o => o.value)).toEqual(enabled)
    })

    it("keeps a stored chain the service no longer offers addressable", () => {
        const options = chainOptionsFor(enabled, "test-13")
        expect(options[0].value).toBe("test-13")
        expect(options[0].label).toContain("no longer offered")
    })

    it("labels a chain Memba models with its network name", () => {
        const option = chainOptionsFor(enabled, "onyx-1").find(o => o.value === "onyx-1")!
        expect(option.label).toContain("Onyx")
        expect(option.label).toContain("onyx-1")
    })

    it("labels a chain Memba does not model with the raw id", () => {
        // Deliberately a chain id Memba will never model, NOT one merely absent
        // from NETWORKS today. This assertion used to use a real chain id, which
        // stopped being unmodelled the moment a hidden entry for it landed —
        // the label gained the network name and this went red for a
        // BEHAVIOUR IMPROVEMENT. gnomonitoring's registry and Memba's NETWORKS
        // drift independently in both directions, so pinning the case to a real
        // id guarantees a recurrence every time either side grows.
        const unmodelled = "definitely-not-a-memba-chain-1"
        const option = chainOptionsFor([...enabled, unmodelled]).find(o => o.value === unmodelled)!
        expect(option.label).toBe(unmodelled)
    })

    it("never duplicates the current value", () => {
        const values = chainOptionsFor(enabled, "onyx-1").map(o => o.value)
        expect(values.filter(v => v === "onyx-1")).toHaveLength(1)
    })

    it("does not label the current chain as retired when the registry is empty", () => {
        // An empty `enabled` list means the /info fetch hasn't resolved (or
        // failed) — it must not be read as "the service dropped this chain".
        const option = chainOptionsFor([], "onyx-1")[0]
        expect(option.value).toBe("onyx-1")
        expect(option.label).toBe("onyx-1")
        expect(option.label).not.toContain("no longer offered")
    })
})

describe("validateWebhookUrl", () => {
    it("accepts the hosts the server accepts", () => {
        expect(validateWebhookUrl("discord", "https://discord.com/api/webhooks/1/x")).toBeNull()
        expect(validateWebhookUrl("discord", "https://discordapp.com/api/webhooks/1/x")).toBeNull()
        expect(validateWebhookUrl("slack", "https://hooks.slack.com/services/x")).toBeNull()
    })

    it("rejects a host the server would reject with an opaque 400", () => {
        expect(validateWebhookUrl("discord", "https://example.com/hook")).toContain("discord.com")
    })

    it("rejects a Slack URL submitted as Discord", () => {
        expect(validateWebhookUrl("discord", "https://hooks.slack.com/services/x")).not.toBeNull()
    })

    it("rejects non-https", () => {
        expect(validateWebhookUrl("discord", "http://discord.com/api/webhooks/1/x"))
            .toContain("https")
    })

    it("rejects empty and malformed input", () => {
        expect(validateWebhookUrl("discord", "   ")).toBe("URL is required")
        expect(validateWebhookUrl("discord", "not a url")).toContain("valid URL")
    })

    it("ignores host casing, as the server does", () => {
        expect(validateWebhookUrl("discord", "https://DISCORD.COM/api/webhooks/1/x")).toBeNull()
    })
})

/**
 * What Adena will be asked to sign, in rows the review sheet shows as the
 * "Adena should show" checklist, and the check that what reaches the
 * broadcaster is exactly what was reviewed.
 *
 * @module os/sign/decode
 */
import type { AminoMsg } from "../../lib/grc20"
import { callDepositCap, deployEffect } from "../../lib/parseMsgs"

export interface SignRow { label: string; value: string; mono?: boolean }

/** "1500000ugnot" → "1.5 GNOT"; anything else is shown as-is. */
export function formatSend(send: unknown): string | null {
    if (typeof send !== "string" || send === "") return null
    return send.split(",").map((coin) => {
        const m = /^(\d{1,30})ugnot$/.exec(coin)
        if (!m) return coin
        const v = BigInt(m[1])
        const whole = v / 1_000_000n
        const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")
        return `${whole}${frac ? `.${frac}` : ""} GNOT`
    }).join(", ")
}

export function adenaChecklist(msgs: readonly AminoMsg[], chainId: string): SignRow[] {
    const rows: SignRow[] = []
    for (const msg of msgs) {
        const v = msg.value ?? {}
        if (msg.type === "/bank.MsgSend") {
            // As Adena 1.21.6 renders a bank send (its default message view): no recipient, no amount.
            rows.push({ label: "Message", value: "Transfer" }, { label: "type", value: "/bank.MsgSend", mono: true }, { label: "function", value: "Transfer", mono: true })
            continue
        }
        if (msg.type === "/auth.m_create_session" || msg.type === "/auth.m_revoke_session") {
            rows.push({ label: "Message", value: msg.type === "/auth.m_create_session" ? "Create session" : "Revoke session" }, { label: "type", value: msg.type, mono: true })
            const paths = Array.isArray(v.allow_paths) ? v.allow_paths.map(String) : []
            if (paths.length) rows.push({ label: "Allowed", value: paths.join(" · "), mono: true })
            const limit = formatSend(v.spend_limit)
            if (limit) rows.push({ label: "Spend limit", value: limit })
            continue
        }
        const deploy = deployEffect(msg)
        if (deploy) {
            rows.push({ label: "Action", value: "Deploy a package" }, { label: "Path", value: deploy.path, mono: true })
            if (deploy.depositCap) rows.push({ label: "Deposit cap", value: deploy.depositCap })
            continue
        }
        rows.push({ label: "Function", value: String(v.func ?? "—"), mono: true }, { label: "Realm", value: String(v.pkg_path ?? "—"), mono: true })
        const args = Array.isArray(v.args) ? v.args.map(String) : []
        if (args.length) rows.push({ label: args.length > 1 ? "Arguments" : "Argument", value: args.join(" · "), mono: true })
        const sends = formatSend(v.send)
        if (sends) rows.push({ label: "Sends", value: sends })
        const cap = callDepositCap(msg)
        if (cap) rows.push({ label: "Deposit cap", value: cap })
    }
    rows.push({ label: "Network", value: chainId, mono: true })
    return rows
}

/** Stable JSON (object keys sorted), so two message lists compare by content. */
function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
    if (v && typeof v === "object") {
        return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
    }
    return JSON.stringify(v) ?? "null"
}

/** True only if the messages about to be signed are exactly the reviewed ones. */
export function sameMsgs(a: readonly AminoMsg[], b: readonly AminoMsg[]): boolean {
    return a.length === b.length && canonical(a) === canonical(b)
}

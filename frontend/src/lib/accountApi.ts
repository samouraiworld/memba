/**
 * The optional account's backend calls. Every call but `confirm` carries the
 * identity provider's session token; `confirm` carries only the token of the
 * link it was sent in.
 *
 * @module lib/accountApi
 */
import { API_BASE_URL } from "./config"

export interface AccountRow {
    id: string
    email?: string
    emailVerifiedAt?: string
    emailUndeliverable?: boolean
    createdAt: string
}

export type Topic = "announcements" | "newsletter" | "early_access"
export type EarlyAccessApp = "launchpad" | "nft" | "session-accounts"

export interface TopicState {
    topic: Topic
    state: "off" | "pending" | "on"
    scope?: string
}

/** The version of the topic wording below (recorded with every request): change it with the text. */
export const WORDING_VERSION = "2026-10-08"

export const TOPICS: readonly { topic: Topic; name: string; text: string }[] = [
    { topic: "announcements", name: "Product announcements", text: "Memba OS milestones and release notes." },
    { topic: "newsletter", name: "Newsletter", text: "The Memba newsletter." },
    { topic: "early_access", name: "Early access", text: "An email when an app you choose opens." },
]

export const EARLY_ACCESS_APPS: Readonly<Record<EarlyAccessApp, string>> = { launchpad: "Token Launchpad", nft: "NFT collections", "session-accounts": "Session accounts" }

export class AccountApiError extends Error {
    constructor(readonly status: number, message: string, readonly code?: string) {
        super(message)
    }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, ...rest } = init
    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
        throw new AccountApiError(res.status, res.status === 409 ? "Another account operation is finishing. Wait a moment, then try again." : body.error ?? `The account service answered ${res.status}.`, body.code)
    }
    return res.status === 204 ? (undefined as T) : await res.json() as T
}

export const accountApi = {
    get: (token: string, signal?: AbortSignal) => call<AccountRow>("/api/account", { token, signal }),
    topics: (token: string, signal?: AbortSignal) => call<TopicState[]>("/api/account/topics", { token, signal }),
    setTopic: (token: string, topic: Topic, on: boolean, source: string, scope = "") =>
        call<TopicState[]>("/api/account/topics", { token, method: "POST", body: JSON.stringify(on ? { topic, on, scope, source, wordingVersion: WORDING_VERSION } : { topic, on }) }),
    exportData: (token: string) => call<unknown>("/api/account/export", { token }),
    remove: (token: string) => call<void>("/api/account/delete", { token, method: "POST" }),
    confirm: (linkToken: string) => call<{ topic: Topic; state: "on" }>("/api/consent/confirm", { method: "POST", body: JSON.stringify({ token: linkToken }) }),
}

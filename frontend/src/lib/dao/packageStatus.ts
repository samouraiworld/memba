/**
 * What the chain holds at a package path, and the lifecycle of a deploy under
 * gnoland-1's "inert" code submission policy.
 *
 * Under "inert", AddPackage stores the package without activating it. An
 * approver enables it later (usually within a block, sometimes never). Until
 * then the realm cannot be called, so a deploy is only a success once the
 * package reads "live".
 *
 * `vm/qpkgmeta_json` answers (captured on gnoland-1, 2026-09-17):
 *   {"path":"…","status":"live","creator":"g1…"}
 *   {"path":"…","status":"inert","creator":"g1…","height":57658,"max_deposit":"12000000ugnot",
 *    "reason":"waiting for a package approver to enable it","pending":true}
 *   {"path":"…","status":"absent"}
 */
import { z } from "zod"
import { abciErrorPresent, directRpcCall } from "../rpcFallback"

export type ChainContext = { rpcUrl: string; chainId: string }

const address = z.string().regex(/^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/)

export const packageMetaSchema = z.strictObject({
    path: z.string().min(1).max(512),
    status: z.enum(["live", "inert", "absent"]),
    creator: address.optional(),
    height: z.number().int().min(0).optional(),
    max_deposit: z.string().regex(/^[0-9]+[a-z][a-z0-9/:._-]*$/).optional(),
    reason: z.string().max(512).optional(),
    pending: z.boolean().optional(),
})

export type PackageMeta = z.infer<typeof packageMetaSchema>

const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")

async function assertChain(ctx: ChainContext, signal?: AbortSignal) {
    const status = z.object({ node_info: z.object({ network: z.string() }) }).parse(await directRpcCall(ctx.rpcUrl, "status", {}, signal))
    if (status.node_info.network !== ctx.chainId) throw new Error("RPC network does not match the selected chain")
}

/** One ABCI query on the selected endpoint after checking it serves the expected chain. */
export async function abciQueryText(ctx: ChainContext, path: string, data: string, signal?: AbortSignal): Promise<string> {
    await assertChain(ctx, signal)
    const params: Record<string, string> = { path: `"${path}"` }
    if (data !== "") params.data = `0x${hex(data)}`
    const result = await directRpcCall(ctx.rpcUrl, "abci_query", params, signal)
    const parsed = z.object({ response: z.object({ ResponseBase: z.object({ Data: z.string().nullable(), Error: z.unknown().optional() }) }) }).parse(result)
    if (abciErrorPresent(parsed.response.ResponseBase.Error) || !parsed.response.ResponseBase.Data) throw new Error(`Query ${path} failed`)
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(parsed.response.ResponseBase.Data), (c) => c.charCodeAt(0)))
}

/** Read the package status. Throws when the node cannot answer; "absent" is an answer. */
export async function packageStatus(ctx: ChainContext, path: string, signal?: AbortSignal): Promise<PackageMeta> {
    const meta = packageMetaSchema.parse(JSON.parse(await abciQueryText(ctx, "vm/qpkgmeta_json", path, signal)))
    if (meta.path !== path) throw new Error("Package status is for another path")
    return meta
}

/** Refuse a path that is already taken, live or waiting for approval. */
export async function assertPathAvailable(ctx: ChainContext, path: string, signal?: AbortSignal): Promise<void> {
    const meta = await packageStatus(ctx, path, signal)
    if (meta.status !== "absent") throw new Error("This path is already used. Choose another realm name.")
}

const policyCache = new Map<string, Promise<string>>()

/** The chain's code_submission_policy (e.g. "inert", "permissionless"), cached per chain and endpoint. */
export function codeSubmissionPolicy(ctx: ChainContext, signal?: AbortSignal): Promise<string> {
    const key = `${ctx.chainId} | ${ctx.rpcUrl}`
    let cached = policyCache.get(key)
    if (!cached) {
        cached = abciQueryText(ctx, "params/vm:p:code_submission_policy", "", signal).then((raw) => z.string().min(1).max(64).parse(JSON.parse(raw)))
        cached.catch(() => policyCache.delete(key))
        policyCache.set(key, cached)
    }
    return cached
}

/** Test hook: forget cached policies. */
export function clearPolicyCache() {
    policyCache.clear()
}

export type DeployOutcome =
    | { outcome: "live"; meta: PackageMeta }
    | { outcome: "pending"; meta: PackageMeta }
    | { outcome: "failed"; meta: PackageMeta | null; error: string }

export interface WaitOptions {
    intervalMs?: number
    timeoutMs?: number
    signal?: AbortSignal
    sleep?: (ms: number) => Promise<void>
    now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Poll a just-submitted package until it is live, or until the timeout.
 * "inert" at the timeout is a pending deploy, not a failure; "absent" after the
 * submission was confirmed means it did not land.
 */
export async function waitForPackage(ctx: ChainContext, path: string, options: WaitOptions = {}): Promise<DeployOutcome> {
    const { intervalMs = 3000, timeoutMs = 120_000, signal, sleep = defaultSleep, now = Date.now } = options
    const deadline = now() + timeoutMs
    let last: PackageMeta | null = null
    let lastError = ""
    for (;;) {
        if (signal?.aborted) return { outcome: "failed", meta: last, error: "Cancelled" }
        try {
            last = await packageStatus(ctx, path, signal)
            if (last.status === "live") return { outcome: "live", meta: last }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err)
        }
        if (now() >= deadline) break
        await sleep(intervalMs)
    }
    if (last?.status === "inert") return { outcome: "pending", meta: last }
    if (last?.status === "absent") return { outcome: "failed", meta: last, error: "The network has no package at this path" }
    return { outcome: "failed", meta: last, error: lastError || "Could not read the package status" }
}

// ── Pending deploys (kept in this browser until the network enables them) ──

export interface PendingDAO {
    chainId: string
    path: string
    name: string
    txHash: string
    reason: string
    submittedAt: number
}

const PENDING_KEY = "memba_pending_daos"

const pendingSchema = z.array(z.strictObject({
    chainId: z.string().min(1).max(64),
    path: z.string().min(1).max(512),
    name: z.string().max(64),
    txHash: z.string().max(128),
    reason: z.string().max(512),
    submittedAt: z.number().int().min(0),
})).max(100)

function readPending(): PendingDAO[] {
    try {
        const raw = localStorage.getItem(PENDING_KEY)
        if (!raw) return []
        const parsed = pendingSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : []
    } catch {
        return []
    }
}

function writePending(list: PendingDAO[]) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-100)))
}

/** Remember a parked deploy; `submittedAt` defaults to now. */
export function savePendingDAO(input: Omit<PendingDAO, "submittedAt"> & { submittedAt?: number }): void {
    const entry: PendingDAO = { ...input, submittedAt: input.submittedAt ?? Date.now() }
    writePending([...readPending().filter((p) => !(p.chainId === entry.chainId && p.path === entry.path)), entry])
}

export function listPendingDAOs(chainId: string): PendingDAO[] {
    return readPending().filter((p) => p.chainId === chainId)
}

export function removePendingDAO(chainId: string, path: string): void {
    writePending(readPending().filter((p) => !(p.chainId === chainId && p.path === path)))
}

/**
 * Re-check pending deploys for a chain (for the DAO list to call on open).
 * Live ones are removed from the pending list and reported to `onLive`.
 */
export async function recheckPendingDAOs(ctx: ChainContext, onLive: (entry: PendingDAO) => void, signal?: AbortSignal): Promise<PendingDAO[]> {
    const still: PendingDAO[] = []
    for (const entry of listPendingDAOs(ctx.chainId)) {
        try {
            const meta = await packageStatus(ctx, entry.path, signal)
            if (meta.status === "live") {
                removePendingDAO(ctx.chainId, entry.path)
                onLive(entry)
                continue
            }
            if (meta.status === "inert" && meta.reason && meta.reason !== entry.reason) {
                savePendingDAO({ ...entry, reason: meta.reason })
            }
        } catch {
            // Unknown for now: keep it pending and try again next time.
        }
        still.push(entry)
    }
    return still
}

/**
 * DAO kind resolution — which contract family a realm really is, decided by
 * its exact path (GovDAO) or by what the realm itself answers, never by a path
 * substring or a self-declared name.
 *
 * The kind drives which transactions Memba builds (builders.ts) and which
 * actions the DAO shell offers (capabilitiesFor). Unknown contracts get no
 * write capability at all.
 */

import { AbciQueryError } from "../rpcFallback"
import type { NETWORKS } from "../config"
import { hasOwnSubpageLink, queryEval, queryRender } from "./shared"
import { parseWeightedQeval, weightedConfigSchema } from "./weighted"

export type DaoKind = "govdao" | "memba-v2" | "memba-v1" | "daokit" | "weighted" | "unknown"

export type DaoProposalKind = "text" | "add_member" | "remove_member" | "change_role" | "archive"

type NetworkConfig = (typeof NETWORKS)[string]

/** The GovDAO realm, matched exactly. Sub-paths and lookalikes are not GovDAO. */
export const GOVDAO_PATHS: ReadonlySet<string> = new Set(["gno.land/r/gov/dao"])

/** Marker exported by generated DAO realms of template version 2. */
export const MEMBA_V2_TEMPLATE_VERSION = "memba-dao/2"
/** API version exported by generated DAO realms of template version 1. */
export const MEMBA_V1_API_VERSION = "1.0"

const MAINNET_CHAIN_ID = "gnoland-1"

/** Gno realm path shape accepted before any query interpolates it. */
const REALM_PATH_RE = /^gno\.land\/r\/[a-z0-9_-]+(?:\/[a-z0-9_]+)*$/
const WEIGHTED_REALM_RE = /^gno\.land\/r\/samcrew\/[a-z][a-z0-9_]{0,63}$/

export function isGovDAOPath(realmPath: string): boolean {
    return GOVDAO_PATHS.has(realmPath)
}

export interface DaoCapabilities {
    propose: ReadonlyArray<DaoProposalKind>
    vote: boolean
    execute: boolean
    membersOnlyWrites: boolean
    channels: boolean
    treasury: false
    settings: boolean
}

const NO_PROPOSALS: ReadonlyArray<DaoProposalKind> = Object.freeze([])
const V1_PROPOSALS: ReadonlyArray<DaoProposalKind> = Object.freeze(["text"])
const V2_PROPOSALS: ReadonlyArray<DaoProposalKind> = Object.freeze(["text", "add_member", "remove_member", "change_role", "archive"])

export function capabilitiesFor(kind: DaoKind, network: NetworkConfig): DaoCapabilities {
    const mainnet = network.chainId === MAINNET_CHAIN_ID
    const channelsNetwork = !mainnet && network.realmsDeployed !== false
    // User DAOs read channels from their own companion realm, offered only where enabled.
    const companionChannels = channelsNetwork && network.userDaos?.channelsCompanion === true
    switch (kind) {
        case "govdao":
            return { propose: NO_PROPOSALS, vote: true, execute: true, membersOnlyWrites: true, channels: false, treasury: false, settings: false }
        case "memba-v2":
            return { propose: V2_PROPOSALS, vote: true, execute: true, membersOnlyWrites: true, channels: companionChannels, treasury: false, settings: true }
        case "memba-v1":
            return { propose: V1_PROPOSALS, vote: true, execute: true, membersOnlyWrites: true, channels: companionChannels, treasury: false, settings: false }
        case "daokit":
            return { propose: NO_PROPOSALS, vote: false, execute: false, membersOnlyWrites: true, channels: channelsNetwork, treasury: false, settings: false }
        case "weighted":
        case "unknown":
        default:
            return { propose: NO_PROPOSALS, vote: false, execute: false, membersOnlyWrites: true, channels: false, treasury: false, settings: false }
    }
}

// ── Resolution ────────────────────────────────────────────────

const kindCache = new Map<string, DaoKind>()
const cacheKey = (chainId: string, realmPath: string) => JSON.stringify([chainId, realmPath])

/** Test hook and network-switch reset. */
export function clearDaoKindCache(): void {
    kindCache.clear()
}

/** Synchronous cache read (for UIs that already resolved the kind this session). */
export function getCachedDaoKind(chainId: string, realmPath: string): DaoKind | undefined {
    return kindCache.get(cacheKey(chainId, realmPath))
}

/** Decode a qeval string return `("<go-quoted>" string)`; null when the shape differs. */
export function parseQevalString(raw: string | null): string | null {
    if (raw === null) return null
    const m = raw.match(/^\(\s*("(?:[^"\\]|\\.)*")\s+string\s*\)\s*$/)
    if (!m) return null
    try {
        const value: unknown = JSON.parse(m[1])
        return typeof value === "string" ? value : null
    } catch {
        return null
    }
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("DAO kind resolution cancelled")
}

/**
 * A probe that the chain answered with a VM error (function not declared,
 * package absent) is a definitive "no". Transport failures propagate so a
 * flaky RPC never gets cached as "unknown".
 */
async function probe<T>(read: () => Promise<T>): Promise<T | null> {
    try {
        return await read()
    } catch (err) {
        if (err instanceof AbciQueryError) return null
        throw err
    }
}

async function probeKind(ctx: { rpcUrl: string; realmPath: string }, signal?: AbortSignal): Promise<DaoKind> {
    const { rpcUrl, realmPath } = ctx

    throwIfAborted(signal)
    const template = parseQevalString(await probe(() => queryEval(rpcUrl, realmPath, "GetTemplateVersion()", true)))
    if (template === MEMBA_V2_TEMPLATE_VERSION) return "memba-v2"
    // A realm that claims a template marker we don't know is not treated as an older version.
    if (template !== null) return "unknown"

    throwIfAborted(signal)
    const api = parseQevalString(await probe(() => queryEval(rpcUrl, realmPath, "GetAPIVersion()", true)))
    if (api === MEMBA_V1_API_VERSION) return "memba-v1"

    throwIfAborted(signal)
    const landing = await probe(() => queryRender(rpcUrl, realmPath, "", true))
    if (landing && hasOwnSubpageLink(landing, realmPath, "proposals")) return "daokit"

    if (WEIGHTED_REALM_RE.test(realmPath)) {
        throwIfAborted(signal)
        const raw = await probe(() => queryEval(rpcUrl, realmPath, "GetConfigJSON()", true))
        if (raw) {
            try {
                const config = weightedConfigSchema.parse(parseWeightedQeval(raw))
                if (config.realmPath === realmPath) return "weighted"
            } catch {
                // Not a weighted host config — fall through.
            }
        }
    }
    return "unknown"
}

/**
 * Resolve the DAO kind for `realmPath` on `chainId`. Cached per chain and
 * realm for the session; only definitive answers are cached.
 */
export async function resolveDaoKind(
    ctx: { rpcUrl: string; chainId: string; realmPath: string },
    signal?: AbortSignal,
): Promise<DaoKind> {
    throwIfAborted(signal)
    if (isGovDAOPath(ctx.realmPath)) return "govdao"
    if (!REALM_PATH_RE.test(ctx.realmPath)) return "unknown"
    const key = cacheKey(ctx.chainId, ctx.realmPath)
    const cached = kindCache.get(key)
    if (cached) return cached
    const kind = await probeKind(ctx, signal)
    throwIfAborted(signal)
    kindCache.set(key, kind)
    return kind
}

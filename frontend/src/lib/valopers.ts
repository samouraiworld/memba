// Valoper registry (gno.land/r/gnops/valopers) — the test13 validator onboarding
// surface. A "valoper" is an operator's on-chain profile (stable operator address +
// rotatable consensus signing key). We read it to show who is *registered* and who is
// *live in the active set* — the candidate pipeline the gno core team built.
//
// Data comes from the realm's Render output (markdown, parsed below), consistent with
// how the rest of the app reads realms. The realm does not expose `KeepRunning` via
// Render (only via qeval), so status is the honest, reliably-derivable 2-state:
//   active    — the valoper's signing address is in the live consensus set
//   candidate — registered but not currently validating
import { GNO_CHAIN_ID } from "./config"
import { directRpcCall, excludeRpcEndpoint, getRpcUrlsInOrder, abciErrorPresent } from "./rpcFallback"

export const VALOPERS_REALM = "gno.land/r/gnops/valopers"

/** The same verified node/height used for the consensus set. */
export interface ValoperRpcSnapshot { url: string; chainId: string; height: number }

function abortError(): DOMException { return new DOMException("Aborted", "AbortError") }

async function verifiedSnapshot(signal?: AbortSignal): Promise<ValoperRpcSnapshot> {
    let lastError: unknown = new Error("No valoper RPC endpoints available")
    for (const url of getRpcUrlsInOrder()) {
        if (signal?.aborted) throw abortError()
        try {
            const status = await directRpcCall(url, "/status", {}, signal) as { node_info?: { network?: string }; sync_info?: { latest_block_height?: string } }
            const chainId = status?.node_info?.network
            if (chainId !== GNO_CHAIN_ID) {
                excludeRpcEndpoint(url)
                lastError = new Error(`Valoper RPC chain mismatch: expected ${GNO_CHAIN_ID}, got ${chainId || "unknown"}`)
                continue
            }
            const height = Number(status?.sync_info?.latest_block_height)
            if (!Number.isSafeInteger(height) || height < 1) {
                lastError = new Error("Valoper RPC returned an invalid block height")
                continue
            }
            return { url, chainId, height }
        } catch (error) { lastError = error }
    }
    if (signal?.aborted) throw abortError()
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Direct ABCI render on a verified node. The global render helper may switch
 * endpoints between pages, so it cannot preserve the consensus snapshot. */
async function renderAt(snapshot: ValoperRpcSnapshot, renderPath: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) throw abortError()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    const onAbort = () => controller.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
        const response = await fetch(snapshot.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: "memba-valopers", method: "abci_query",
                params: {
                    path: "vm/qrender",
                    data: btoa(`${VALOPERS_REALM}:${renderPath}`),
                    height: String(snapshot.height),
                },
            }),
            signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Valoper RPC HTTP ${response.status}`)
        const json = await response.json()
        if (signal?.aborted) throw abortError()
        if (json?.error) throw new Error(`Valoper RPC error: ${json.error.message || JSON.stringify(json.error)}`)
        const base = json?.result?.response?.ResponseBase
        if (!base) throw new Error("Malformed valoper ABCI response")
        if (abciErrorPresent(base.Error)) throw new Error(`Valoper ABCI error: ${base.Log || JSON.stringify(base.Error)}`)
        if (!base.Data) return null
        const bytes = Uint8Array.from(atob(base.Data), c => c.charCodeAt(0))
        return new TextDecoder().decode(bytes)
    } finally {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", onAbort)
    }
}

/** A registered valoper's public profile from gno.land/r/gnops/valopers. */
export interface Valoper {
    /** Human-readable name. */
    moniker: string
    /** Operator-provided description (may be empty). */
    description: string
    /** Stable operator identity (g1…), the profile key across signing-key rotations. */
    operatorAddress: string
    /** Current consensus signing address (g1…); empty if not parseable. */
    signingAddress: string
    /** Current consensus signing pubkey (gpub1…); empty if not parseable. */
    signingPubKey: string
    /** "cloud" | "on-prem" | "data-center" (or "" if absent). */
    serverType: string
}

export type ValoperStatus = "active" | "candidate"

export interface ValoperWithStatus extends Valoper {
    status: ValoperStatus
}

// renderHome list line:
//   " * [Moniker](/r/gnops/valopers:g1op) - [profile](/r/demo/profile:u/g1op)"
const LIST_LINE_RE = /\*\s+\[([^\]]+)\]\(\/r\/gnops\/valopers:(g1[a-z0-9]+)\)/g

/** Parse the valoper roster (Render("")) → moniker + operator address per entry.
 *  Instruction text and the pager are ignored (they don't match the line shape). */
export function parseValoperList(raw: string): { moniker: string; operatorAddress: string }[] {
    const out: { moniker: string; operatorAddress: string }[] = []
    if (!raw) return out
    for (const m of raw.matchAll(LIST_LINE_RE)) {
        out.push({ moniker: m[1].trim(), operatorAddress: m[2] })
    }
    return out
}

/** Parse a single valoper's detail render (Valoper.Render()) → Valoper, or null when the
 *  realm returned an "unknown/invalid address" response (no heading + no operator field). */
export function parseValoperDetail(raw: string): Valoper | null {
    if (!raw) return null
    const monikerMatch = raw.match(/^##\s+(.+)$/m)
    const operatorMatch = raw.match(/-\s*Operator Address:\s*(g1[a-z0-9]+)/)
    if (!monikerMatch || !operatorMatch) return null

    const signingMatch = raw.match(/-\s*Signing Address:\s*(g1[a-z0-9]+)/)
    const pubKeyMatch = raw.match(/-\s*Signing PubKey:\s*(gpub1[a-z0-9]+)/)
    const serverMatch = raw.match(/-\s*Server Type:\s*(.+)$/m)

    // Description is the text between the "## Moniker" heading and the first field line.
    let description = ""
    const headingEnd = (monikerMatch.index ?? 0) + monikerMatch[0].length
    const fieldStart = operatorMatch.index ?? -1
    if (fieldStart > headingEnd) {
        description = raw.slice(headingEnd, fieldStart).trim()
    }

    return {
        moniker: monikerMatch[1].trim(),
        description,
        operatorAddress: operatorMatch[1],
        signingAddress: signingMatch ? signingMatch[1] : "",
        signingPubKey: pubKeyMatch ? pubKeyMatch[1] : "",
        serverType: serverMatch ? serverMatch[1].trim() : "",
    }
}

/** A valoper is "active" when its signing address is in the live consensus set, else
 *  "candidate" (registered but not currently validating). */
export function computeValoperStatus(
    signingAddress: string,
    activeSigningAddresses: Set<string>,
): ValoperStatus {
    return signingAddress && activeSigningAddresses.has(signingAddress) ? "active" : "candidate"
}

/** The three identity cases a unified validator profile can render, plus the
 *  not-found fallback. See resolveValidatorProfile(). */
export type ProfileIdentityCase =
    | "registered-active"     // valoper whose signing key is in the active set
    | "registered-candidate"  // valoper registered but not currently validating
    | "genesis"               // in the active set but no valoper record
    | "not-found"

export interface ValidatorProfileResolution {
    identityCase: ProfileIdentityCase
    /** The address the canonical URL should use: the operator address for a
     *  registered valoper, the signing address for a genesis validator. */
    canonicalAddress: string
    /** True when the incoming address ≠ canonicalAddress, so the page should
     *  redirect (e.g. a signing-address deep link → the operator route). */
    shouldRedirect: boolean
    /** The matched valoper record, or null (genesis / not-found). */
    valoper: ValoperWithStatus | null
    /** The consensus/signing address whose live metrics to fetch; "" if none. */
    performanceAddress: string
    /** Whether performanceAddress is in the live consensus set (→ show metrics). */
    isActive: boolean
}

/** Classify an incoming /validators/:address into one identity case, resolving the
 *  canonical address and whether to redirect. Pure (no I/O) so callers can fetch the
 *  valoper list + active set once and resolve synchronously.
 *
 *  Resolution order matters: a registered valoper is matched (by operator OR signing
 *  address) before the genesis fallback, because an active valoper's signing address is
 *  itself in the active set. The operator address is always canonical when a valoper
 *  record exists; only a genesis validator is canonical by its signing address. */
export function resolveValidatorProfile(
    address: string | undefined,
    valopers: ValoperWithStatus[],
    activeSigningAddresses: Set<string>,
): ValidatorProfileResolution {
    const notFound: ValidatorProfileResolution = {
        identityCase: "not-found",
        canonicalAddress: address ?? "",
        shouldRedirect: false,
        valoper: null,
        performanceAddress: "",
        isActive: false,
    }
    if (!address) return notFound

    const byOperator = valopers.find(v => v.operatorAddress === address)
    const bySigning = byOperator ? null : valopers.find(v => v.signingAddress === address)
    const matched = byOperator ?? bySigning

    if (matched) {
        const isActive = matched.status === "active"
        return {
            identityCase: isActive ? "registered-active" : "registered-candidate",
            canonicalAddress: matched.operatorAddress,
            // Redirect only when reached via a signing-address deep link (never from the
            // operator route itself — guards against a redirect loop).
            shouldRedirect: address !== matched.operatorAddress,
            valoper: matched,
            performanceAddress: matched.signingAddress,
            isActive,
        }
    }

    if (activeSigningAddresses.has(address)) {
        return {
            identityCase: "genesis",
            canonicalAddress: address,
            shouldRedirect: false,
            valoper: null,
            performanceAddress: address,
            isActive: true,
        }
    }

    return notFound
}

/** Fetch the FULL valoper roster across all pages.
 *
 *  The realm paginates `Render("")` at 50 entries/page with a `[N](?page=N)` pager, so
 *  reading only page 1 silently caps the roster at 50 (and undercounts candidates as new
 *  operators register). This walks every page until there is no link to the next page,
 *  the page is empty, or it stops yielding new entries. An advertised next page
 *  that is empty or repeats earlier entries is an incomplete registry, not EOF. */
export async function fetchValoperListPaged(
    rpcUrl: string,
    snapshot?: ValoperRpcSnapshot,
    signal?: AbortSignal,
): Promise<{ moniker: string; operatorAddress: string }[]> {
    void rpcUrl // compatibility with existing callers; reads use a verified node
    const selected = snapshot ?? await verifiedSnapshot(signal)
    const MAX_PAGES = 50 // safety cap (50 × 50 = 2500 valopers) against a missing stop marker
    const out: { moniker: string; operatorAddress: string }[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= MAX_PAGES; page++) {
        if (signal?.aborted) throw abortError()
        const raw = await renderAt(selected, page === 1 ? "" : `?page=${page}`, signal)
        if (!raw) {
            if (page > 1) throw new Error(`Valoper registry page ${page} is empty after being advertised`)
            break
        }
        let added = 0
        for (const e of parseValoperList(raw)) {
            if (!seen.has(e.operatorAddress)) {
                seen.add(e.operatorAddress)
                out.push(e)
                added++
            }
        }
        if (added === 0) {
            if (page > 1 || raw.includes(`?page=${page + 1}`)) {
                throw new Error(`Valoper registry page ${page} repeats or contains no entries`)
            }
            break
        }
        if (!raw.includes(`?page=${page + 1}`)) break // no link to the next page → last page
        if (page === MAX_PAGES) throw new Error(`Valoper registry exceeds the ${MAX_PAGES}-page safety limit`)
    }
    return out
}

/** Resolve one profile against a complete registry list at the verified height.
 * Operator routes fetch only their own detail. Signing-address routes must scan
 * details because the list contains operator addresses only. A failed scan may
 * return a verified match, but cannot declare a genesis/not-found identity. */
export async function findValoperForProfile(
    rpcUrl: string,
    address: string,
    activeSigningAddresses: Set<string>,
    snapshot?: ValoperRpcSnapshot,
    signal?: AbortSignal,
): Promise<ValoperWithStatus | null> {
    const selected = snapshot ?? await verifiedSnapshot(signal)
    const list = await fetchValoperListPaged(rpcUrl, selected, signal)
    const withStatus = (detail: Valoper): ValoperWithStatus => ({
        ...detail,
        status: computeValoperStatus(detail.signingAddress, activeSigningAddresses),
    })
    const readDetail = async (operatorAddress: string, readSignal?: AbortSignal): Promise<Valoper> => {
        const raw = await renderAt(selected, operatorAddress, readSignal)
        const detail = raw ? parseValoperDetail(raw) : null
        if (!detail || detail.operatorAddress !== operatorAddress) {
            throw new Error(`Valoper detail missing or inconsistent for ${operatorAddress}`)
        }
        return detail
    }

    const operator = list.find(entry => entry.operatorAddress === address)
    if (operator) return withStatus(await readDetail(operator.operatorAddress, signal))
    if (list.length === 0) return null

    const scanController = new AbortController()
    const onAbort = () => scanController.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) scanController.abort()
    let nextIndex = 0
    let match: Valoper | null = null
    let failure: unknown = null
    try {
        await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => {
            for (;;) {
                if (match || scanController.signal.aborted) return
                const index = nextIndex++
                if (index >= list.length) return
                try {
                    const detail = await readDetail(list[index].operatorAddress, scanController.signal)
                    if (detail.signingAddress === address) {
                        match = detail
                        scanController.abort() // stop unrelated in-flight reads once verified
                        return
                    }
                } catch (error) {
                    // A bad unrelated detail cannot hide a subsequently verified
                    // match, but it prevents a safe genesis/not-found conclusion.
                    if (!scanController.signal.aborted) failure ??= error
                }
            }
        }))
        if (signal?.aborted) throw abortError()
        if (match) return withStatus(match)
        if (failure) throw new Error("Valoper registry scan incomplete", { cause: failure })
        return null
    } finally {
        signal?.removeEventListener("abort", onAbort)
    }
}

/** Fetch every registered valoper with its live status.
 *  @param activeSigningAddresses gno addresses (g1…) currently in the consensus set,
 *         i.e. `getValidators(...).map(v => v.gnoAddr)`. */
export async function fetchValopers(
    rpcUrl: string,
    activeSigningAddresses: Set<string>,
    snapshot?: ValoperRpcSnapshot,
    signal?: AbortSignal,
): Promise<ValoperWithStatus[]> {
    const selected = snapshot ?? await verifiedSnapshot(signal)
    const list = await fetchValoperListPaged(rpcUrl, selected, signal)
    if (list.length === 0) return []

    // Bounded worker pool: a 2,500-entry realm must never issue 2,500 ABCI
    // requests simultaneously or swamp a public node every refresh.
    const details: Valoper[] = []
    let nextIndex = 0
    let failure: unknown = null
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => {
        for (;;) {
            if (failure || signal?.aborted) return
            const index = nextIndex++
            if (index >= list.length) return
            try {
                const operatorAddress = list[index].operatorAddress
                const raw = await renderAt(selected, operatorAddress, signal)
                if (signal?.aborted) throw abortError()
                const detail = raw ? parseValoperDetail(raw) : null
                if (!detail || detail.operatorAddress !== operatorAddress) {
                    throw new Error(`Valoper detail missing or inconsistent for ${operatorAddress}`)
                }
                details[index] = detail
            } catch (error) {
                failure = error
                return
            }
        }
    }))
    if (signal?.aborted) throw abortError()
    if (failure) throw failure

    return details
        .map(v => ({ ...v, status: computeValoperStatus(v.signingAddress, activeSigningAddresses) }))
}

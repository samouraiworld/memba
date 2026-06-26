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
import { queryRender } from "./dao/shared"

export const VALOPERS_REALM = "gno.land/r/gnops/valopers"

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

/** Fetch every registered valoper with its live status.
 *  @param activeSigningAddresses gno addresses (g1…) currently in the consensus set,
 *         i.e. `getValidators(...).map(v => v.gnoAddr)`. */
export async function fetchValopers(
    rpcUrl: string,
    activeSigningAddresses: Set<string>,
): Promise<ValoperWithStatus[]> {
    const listRaw = await queryRender(rpcUrl, VALOPERS_REALM, "")
    if (!listRaw) return []

    const list = parseValoperList(listRaw)
    const details = await Promise.all(
        list.map(async ({ operatorAddress }) => {
            try {
                const raw = await queryRender(rpcUrl, VALOPERS_REALM, operatorAddress)
                return raw ? parseValoperDetail(raw) : null
            } catch {
                return null
            }
        }),
    )

    return details
        .filter((v): v is Valoper => v !== null)
        .map(v => ({ ...v, status: computeValoperStatus(v.signingAddress, activeSigningAddresses) }))
}

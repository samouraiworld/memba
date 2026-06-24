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
import { GNO_CHAIN_ID, getExplorerBaseUrl } from "./config"

export const VALOPERS_REALM = "gno.land/r/gnops/valopers"

/** gnoweb base for valoper profile links. Pinned to gno-core's canonical test13
 *  gnoweb (verified live 2026-06-24: renders r/gnops/valopers profiles), kept
 *  SEPARATE from the shared explorer host so profile/directory links stay
 *  untouched (zero blast radius). Env-overridable. */
export function valoperGnowebBase(): string {
    if (GNO_CHAIN_ID === "test-13")
        return import.meta.env.VITE_TEST13_VALOPER_GNOWEB_URL || "https://gnoweb.test-13.gnoland.network"
    return getExplorerBaseUrl()
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

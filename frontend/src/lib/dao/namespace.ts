/**
 * Who may deploy under a realm namespace.
 *
 * Asks the chain's own verifier, `gno.land/r/sys/names.IsAuthorizedAddressForNamespace`,
 * which is what AddPackage checks: the deployer's own address, or a name the
 * deployer registered and still holds as its current name. A paused verifier
 * refuses everyone, and so does this check.
 */
import { validateRealmPath } from "../templates/sanitizer"
import { isChecksummedAddress } from "../templates/dao/v2/bech32"
import { abciQueryText, type ChainContext } from "./packageStatus"

export const NAMESPACE_REFUSED = "You can deploy only under your own address or a name you registered"

export function realmNamespace(realmPath: string): string {
    const err = validateRealmPath(realmPath)
    if (err) throw new Error(`Invalid realm path: ${err}`)
    return realmPath.slice("gno.land/r/".length).split("/")[0]
}

export async function assertCanDeployTo(ctx: ChainContext, signer: string, realmPath: string, signal?: AbortSignal): Promise<void> {
    const ns = realmNamespace(realmPath)
    if (!isChecksummedAddress(signer, "g")) throw new Error("Connect a valid wallet address first")
    // ns is validated to [a-z0-9_] or nym-…, and signer to bech32: neither can
    // break out of the quoted expression.
    const raw = (await abciQueryText(ctx, "vm/qeval", `gno.land/r/sys/names.IsAuthorizedAddressForNamespace(address("${signer}"), "${ns}")`, signal)).trim()
    if (raw === "(true bool)") return
    if (raw === "(false bool)") throw new Error(NAMESPACE_REFUSED)
    throw new Error("Could not verify the namespace")
}

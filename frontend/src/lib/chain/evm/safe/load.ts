/**
 * The one way into the Safe SDK (./sdk.ts). Like the EVM adapter's loader, the
 * guard sits on the `import()` itself: with the flag off it folds to a
 * rejected promise and the vendor-safe chunk is never emitted.
 *
 * @module lib/chain/evm/safe/load
 */
import { EVM_ENABLED } from "../../flag"

type SafeSdk = typeof import("./sdk")

let sdk: Promise<SafeSdk> | null = null

export function loadSafeSdk(): Promise<SafeSdk> {
    if (!EVM_ENABLED) return Promise.reject(new Error("The EVM network is off in this build."))
    // A chunk that failed to load (offline, new deploy) is asked for again next time.
    return (sdk ??= import("./sdk").catch((err: unknown) => { sdk = null; throw err }))
}

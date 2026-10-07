/**
 * The one way into the EVM adapter. The guard sits on the `import()` itself:
 * with the flag off it folds to a rejected promise and the adapter chunk is
 * never emitted, whichever module calls this (checked by check:bundle:evm).
 *
 * @module lib/chain/evm/load
 */
import { EVM_ENABLED } from "../flag"

type Adapter = typeof import("./adapter")

let adapter: Promise<Adapter> | null = null

export function loadEvmAdapter(): Promise<Adapter> {
    if (!EVM_ENABLED) return Promise.reject(new Error("The EVM network is off in this build."))
    // A chunk that failed to load (offline, new deploy) is asked for again next time.
    return (adapter ??= import("./adapter").catch((err: unknown) => { adapter = null; throw err }))
}

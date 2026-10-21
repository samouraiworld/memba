/**
 * The dev-only local network: a gnodev node on this machine, for reading realms
 * before they exist on a public chain (first user: the validator selection
 * scores realm). It exists only on the dev server with
 * VITE_ENABLE_LOCAL_NETWORK=true; production builds never carry it.
 *
 * Dependency-free on purpose: lib/config.ts and vite.config.ts both import it.
 *
 * @module lib/localNetwork
 */

export const LOCAL_NETWORK_KEY = "local"
/** gnodev's default chain id. */
export const LOCAL_CHAIN_ID = "dev"
/** gnodev's default RPC listener. */
export const LOCAL_RPC_URL = "http://localhost:26657"
/** gnodev's default gnoweb listener. */
export const LOCAL_GNOWEB_URL = "http://localhost:8888"

/**
 * The flag rule, for a dev build (config.ts checks `import.meta.env.DEV` itself so
 * a production bundle folds the whole network away). Never in Vitest's `test` mode:
 * Vitest reads the repo-root .env, and a developer's local flag must not change
 * what the unit tests see.
 */
export function localNetworkEnabled(mode: string, flag: string | undefined): boolean {
    return mode !== "test" && flag === "true"
}

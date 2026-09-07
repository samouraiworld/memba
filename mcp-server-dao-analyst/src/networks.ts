/**
 * Network aliases accepted by `dao_set_network`.
 *
 * Keyed by network NAME, not on-wire chain-id: `pearl` is chain-id `pearl-1`,
 * the current Memba chain. Retired chains (test13, topaz, sapphire) have no
 * alias on purpose — their hosts are gone, so an alias would only hand the
 * caller a connection error.
 */

export const PEARL_RPC_URL = "https://rpc.pearl.samourai.live:443";

/** Static aliases; `pearl` is env-overridable via PEARL_RPC_URL (see resolveNetworkRpc). */
export const KNOWN_NETWORKS: Record<string, string> = {
  mainnet: "https://rpc.gno.land",
  test5: "https://rpc.test5.gno.land",
  pearl: PEARL_RPC_URL,
};

export const KNOWN_NETWORK_NAMES = Object.keys(KNOWN_NETWORKS);

/**
 * Resolve a network name or full RPC URL to an RPC URL.
 * Returns null when the input is neither a known alias nor an http(s) URL.
 * Env overrides are read per call so a switch mid-session sees the live value.
 */
export function resolveNetworkRpc(network: string): string | null {
  const name = network.toLowerCase();
  if (name === "pearl") return process.env.PEARL_RPC_URL || PEARL_RPC_URL;
  const known = KNOWN_NETWORKS[name];
  if (known) return known;
  return network.startsWith("http") ? network : null;
}

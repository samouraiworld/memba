/**
 * Network aliases accepted by `dao_set_network`.
 *
 * Keyed by network NAME, not on-wire chain-id: `mainnet` is chain-id
 * `gnoland-1`, the current Memba chain (the default when GNO_RPC_URL is unset).
 * Retired chains (pearl, test13, topaz, sapphire) have no alias on purpose —
 * Memba no longer runs on them, so an alias would only point the caller at a
 * dead or abandoned chain. A full RPC URL still works for any of them.
 */

/** Static aliases. */
export const KNOWN_NETWORKS: Record<string, string> = {
  mainnet: "https://rpc.gno.land",
  test5: "https://rpc.test5.gno.land",
};

export const KNOWN_NETWORK_NAMES = Object.keys(KNOWN_NETWORKS);

/**
 * Resolve a network name or full RPC URL to an RPC URL.
 * Returns null when the input is neither a known alias nor an http(s) URL.
 */
export function resolveNetworkRpc(network: string): string | null {
  const name = network.toLowerCase();
  const known = KNOWN_NETWORKS[name];
  if (known) return known;
  return network.startsWith("http") ? network : null;
}

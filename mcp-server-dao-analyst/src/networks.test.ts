import { describe, it, expect } from "vitest";
import { KNOWN_NETWORKS, resolveNetworkRpc } from "./networks.js";

// Pearl joined the retired set on 2026-09-23, when Memba moved to mainnet.
const RETIRED = ["test13", "testnet13", "topaz", "sapphire", "test12", "pearl", "test5"];

describe("dao_set_network aliases", () => {
  it("resolves mainnet (the current Memba chain) to the official node", () => {
    expect(resolveNetworkRpc("mainnet")).toBe("https://rpc.gno.land");
    expect(resolveNetworkRpc("MAINNET")).toBe("https://rpc.gno.land");
  });

  it("has no alias for a retired chain", () => {
    for (const marker of RETIRED) {
      expect(resolveNetworkRpc(marker)).toBeNull();
      for (const url of Object.values(KNOWN_NETWORKS)) {
        expect(url.toLowerCase()).not.toContain(marker);
      }
    }
  });

  it("resolves onyx (the gno.land testnet)", () => {
    expect(resolveNetworkRpc("onyx")).toBe("https://rpc.onyx.testnets.gno.land");
  });

  it("passes a full RPC URL through and rejects anything else", () => {
    expect(resolveNetworkRpc("https://custom.example:443")).toBe("https://custom.example:443");
    expect(resolveNetworkRpc("not-a-network")).toBeNull();
  });
});

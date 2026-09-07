import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KNOWN_NETWORKS, resolveNetworkRpc } from "./networks.js";

const RETIRED = ["test13", "testnet13", "topaz", "sapphire", "test12"];

describe("dao_set_network aliases", () => {
  const saved = process.env.PEARL_RPC_URL;
  beforeEach(() => { delete process.env.PEARL_RPC_URL; });
  afterEach(() => { if (saved !== undefined) process.env.PEARL_RPC_URL = saved; });

  it("resolves pearl (the current Memba chain) to the canonical node", () => {
    expect(resolveNetworkRpc("pearl")).toBe("https://rpc.pearl.samourai.live:443");
    expect(resolveNetworkRpc("PEARL")).toBe("https://rpc.pearl.samourai.live:443");
  });

  it("lets PEARL_RPC_URL override the pearl alias at call time", () => {
    process.env.PEARL_RPC_URL = "https://pearl.example:443";
    expect(resolveNetworkRpc("pearl")).toBe("https://pearl.example:443");
  });

  it("has no alias for a retired chain", () => {
    for (const marker of RETIRED) {
      expect(resolveNetworkRpc(marker)).toBeNull();
      for (const url of Object.values(KNOWN_NETWORKS)) {
        expect(url.toLowerCase()).not.toContain(marker);
      }
    }
  });

  it("keeps the pre-existing aliases", () => {
    expect(resolveNetworkRpc("mainnet")).toBe("https://rpc.gno.land");
    expect(resolveNetworkRpc("test5")).toBe("https://rpc.test5.gno.land");
  });

  it("passes a full RPC URL through and rejects anything else", () => {
    expect(resolveNetworkRpc("https://custom.example:443")).toBe("https://custom.example:443");
    expect(resolveNetworkRpc("not-a-network")).toBeNull();
  });
});

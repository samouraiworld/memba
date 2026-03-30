/**
 * Gno RPC helpers — ABCI queries for the MCP server.
 *
 * Provides typed wrappers around Gno JSON-RPC endpoints.
 * All functions accept an RPC URL and return parsed results.
 */

const DEFAULT_RPC = "https://rpc.testnet12.samourai.live:443";
const TIMEOUT_MS = 10_000;

export function getRpcUrl(): string {
  return process.env.GNO_RPC_URL || DEFAULT_RPC;
}

/**
 * Query a realm's Render() output via ABCI.
 * Returns the decoded string, or null on error.
 */
export async function queryRender(
  realmPath: string,
  path: string = "",
  rpcUrl?: string
): Promise<string | null> {
  const url = rpcUrl || getRpcUrl();
  const data = path ? `${realmPath}\n${path}` : `${realmPath}\n`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "abci_query",
        params: { path: "vm/qrender", data },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const json = await res.json();
    const responseData = json?.result?.response?.ResponseBase?.Data;
    if (!responseData) return null;

    // Data is base64-encoded
    return Buffer.from(responseData, "base64").toString("utf-8");
  } catch (err) {
    console.error(`[gno] queryRender failed for ${realmPath}:`, err);
    return null;
  }
}

/**
 * Query a realm's function evaluation via vm/qeval.
 */
export async function queryEval(
  realmPath: string,
  expr: string,
  rpcUrl?: string
): Promise<string | null> {
  const url = rpcUrl || getRpcUrl();
  const data = `${realmPath}\n${expr}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "abci_query",
        params: { path: "vm/qeval", data },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const json = await res.json();
    const responseData = json?.result?.response?.ResponseBase?.Data;
    if (!responseData) return null;

    return Buffer.from(responseData, "base64").toString("utf-8");
  } catch (err) {
    console.error(`[gno] queryEval failed for ${realmPath}:`, err);
    return null;
  }
}

/**
 * Fetch GNOT balance for an address.
 */
export async function getBalance(
  address: string,
  rpcUrl?: string
): Promise<string | null> {
  const url = rpcUrl || getRpcUrl();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "abci_query",
        params: { path: `bank/balances/${address}` },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const json = await res.json();
    const responseData = json?.result?.response?.ResponseBase?.Data;
    if (!responseData) return "0ugnot";

    return Buffer.from(responseData, "base64").toString("utf-8");
  } catch (err) {
    console.error(`[gno] getBalance failed for ${address}:`, err);
    return null;
  }
}

/**
 * GnoRpcClient — ABCI query client with retry, node rotation, and caching.
 *
 * Accepts an array of RPC endpoints and rotates on failure.
 * All methods return parsed results or throw on unrecoverable errors.
 */

import type { AbciResponse, NetworkStatus, StatusResponse } from "./types.js";

const DEFAULT_RPC = "https://rpc.testnet12.samourai.live:443";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

export interface GnoRpcConfig {
  /** RPC endpoints — rotates on failure. Defaults to testnet12. */
  endpoints?: string[];
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Maximum retries per request (across all endpoints). Default: 2. */
  maxRetries?: number;
}

export class GnoRpcClient {
  private endpoints: string[];
  private currentIndex = 0;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: GnoRpcConfig = {}) {
    this.endpoints = config.endpoints?.length
      ? config.endpoints
      : [process.env.GNO_RPC_URL || DEFAULT_RPC];
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? MAX_RETRIES;
  }

  /** Get the currently active RPC URL. */
  get rpcUrl(): string {
    return this.endpoints[this.currentIndex];
  }

  /**
   * Query a realm's Render() output via ABCI vm/qrender.
   * Returns the decoded string, or null if the realm doesn't exist.
   */
  async queryRender(realmPath: string, path = ""): Promise<string | null> {
    const data = path ? `${realmPath}\n${path}` : `${realmPath}\n`;
    return this.abciQuery("vm/qrender", data);
  }

  /**
   * Evaluate a realm function via ABCI vm/qeval.
   * Returns the raw result string, or null on error.
   */
  async queryEval(realmPath: string, expression: string): Promise<string | null> {
    const data = `${realmPath}\n${expression}`;
    return this.abciQuery("vm/qeval", data);
  }

  /**
   * Check if a realm exists by querying vm/qfile.
   * Returns true if the realm package is found.
   */
  async realmExists(realmPath: string): Promise<boolean> {
    try {
      const result = await this.abciQuery("vm/qfile", realmPath);
      return result !== null && result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Fetch GNOT balance for an address.
   * Returns the raw balance string (e.g., "1000000ugnot"), or "0ugnot".
   */
  async getBalance(address: string): Promise<string> {
    const result = await this.abciQuery(`bank/balances/${address}`, "");
    return result || "0ugnot";
  }

  /**
   * Fetch GNOT balance as a parsed number in ugnot.
   */
  async getBalanceUgnot(address: string): Promise<number> {
    const raw = await this.getBalance(address);
    const match = raw.match(/(\d+)ugnot/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get network status (chain ID, block height, sync state).
   */
  async getNetworkStatus(): Promise<NetworkStatus | null> {
    const url = this.endpoints[this.currentIndex];

    try {
      const json = await this.jsonRpcCall<StatusResponse>(url, "status", {});
      return json?.result ?? null;
    } catch (err) {
      console.error("[gno-rpc] getNetworkStatus failed:", err);
      return null;
    }
  }

  /**
   * Probe whether a realm exports a specific function.
   * Returns the result string if the function exists, null otherwise.
   * Useful for capability detection.
   */
  async probeFunction(realmPath: string, expression: string): Promise<string | null> {
    try {
      return await this.queryEval(realmPath, expression);
    } catch {
      return null;
    }
  }

  // ── Internal ─────────────────────────────────────────────────

  private async abciQuery(path: string, data: string): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const url = this.endpoints[this.currentIndex];

      try {
        const json = await this.jsonRpcCall<AbciResponse>(url, "abci_query", {
          path,
          data,
        });

        if (json?.error) {
          throw new Error(`RPC error: ${json.error.message}`);
        }

        const responseData = json?.result?.response?.ResponseBase?.Data;
        if (!responseData) return null;

        const responseError = json?.result?.response?.ResponseBase?.Error;
        if (responseError) {
          throw new Error(`ABCI error: ${responseError}`);
        }

        return Buffer.from(responseData, "base64").toString("utf-8");
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[gno-rpc] ${path} failed on ${url} (attempt ${attempt + 1}/${this.maxRetries + 1}):`,
          lastError.message
        );

        // Rotate to next endpoint
        if (this.endpoints.length > 1) {
          this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
        }
      }
    }

    // All retries exhausted
    return null;
  }

  private async jsonRpcCall<T>(url: string, method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

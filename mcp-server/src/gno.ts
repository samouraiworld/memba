/**
 * Gno RPC helpers — re-exported from @samouraiworld/gno-rpc.
 *
 * This file maintains backward compatibility for the memba-mcp server
 * while delegating to the shared gno-rpc package.
 */

import { GnoRpcClient } from "@samouraiworld/gno-rpc";

const client = new GnoRpcClient();

export function getRpcUrl(): string {
  return client.rpcUrl;
}

export async function queryRender(
  realmPath: string,
  path = "",
  rpcUrl?: string
): Promise<string | null> {
  if (rpcUrl) {
    const custom = new GnoRpcClient({ endpoints: [rpcUrl] });
    return custom.queryRender(realmPath, path);
  }
  return client.queryRender(realmPath, path);
}

export async function queryEval(
  realmPath: string,
  expr: string,
  rpcUrl?: string
): Promise<string | null> {
  if (rpcUrl) {
    const custom = new GnoRpcClient({ endpoints: [rpcUrl] });
    return custom.queryEval(realmPath, expr);
  }
  return client.queryEval(realmPath, expr);
}

export async function getBalance(
  address: string,
  rpcUrl?: string
): Promise<string | null> {
  if (rpcUrl) {
    const custom = new GnoRpcClient({ endpoints: [rpcUrl] });
    return custom.getBalance(address);
  }
  return client.getBalance(address);
}

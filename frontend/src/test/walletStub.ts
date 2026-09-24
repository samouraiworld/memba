import { vi } from "vitest"
import { GNO_CHAIN_ID } from "../lib/config"

/** A trusted RPC for the wallet stub to report. */
export const STUB_WALLET_RPC = "https://rpc.gno.land:443"

/**
 * The read side of an Adena stub that answers the live network check the
 * signing path runs before every wallet request. Spread it next to the
 * DoContract stub a test needs: `{ ...liveWallet(), DoContract }`.
 */
export function liveWallet(opts: { chainId?: string; networkChainId?: string; address?: string; rpcUrl?: string } = {}) {
    const chainId = opts.chainId ?? GNO_CHAIN_ID
    return {
        GetAccount: vi.fn(async () => ({ status: "success", data: { address: opts.address ?? "g1stub", chainId } })),
        GetNetwork: vi.fn(async () => ({ status: "success", data: { chainId: opts.networkChainId ?? chainId, rpcUrl: opts.rpcUrl ?? STUB_WALLET_RPC } })),
    }
}

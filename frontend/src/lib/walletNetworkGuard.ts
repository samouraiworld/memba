/**
 * Live wallet-network check, run right before a transaction is handed to the
 * wallet for signing.
 *
 * Realm calls do not name a chain, and the same realm paths exist on several
 * networks, so a wallet that is on another network signs a valid transaction
 * for that network. The cached chain id kept by useAdena can be stale (a
 * wallet that switched network without firing its change event) or empty (a
 * wallet that reports no chain), so this asks the wallet again and fails
 * closed: an empty or unknown chain, an account and a network that disagree,
 * or a chain other than the page's all refuse.
 */
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, NETWORKS, isTrustedRpcDomain } from "./config"

type WalletReply = { status?: unknown; data?: { address?: unknown; chainId?: unknown; rpcUrl?: unknown } | null } | null | undefined

type AdenaNetworkApi = {
    GetAccount?: () => Promise<WalletReply>
    GetNetwork?: () => Promise<WalletReply>
}

/** What the wallet reported when the check passed. */
export interface LiveWalletNetwork {
    chainId: string
    address: string
    /** Empty when the wallet did not report its RPC. */
    rpcUrl: string
}

/** How long the wallet has to answer before the check refuses. */
export const LIVE_NETWORK_TIMEOUT_MS = 15_000

/**
 * A refusal by this check. It is thrown before the wallet is asked anything
 * that could sign, so a caller can treat it as "nothing was sent".
 */
export class WalletNetworkError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "WalletNetworkError"
    }
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** "gno.land (gnoland-1)" for a known chain, the bare chain id otherwise. */
export function networkLabelForChain(chainId: string): string {
    const active = NETWORKS[ACTIVE_NETWORK_KEY]
    const net = active?.chainId === chainId ? active : Object.values(NETWORKS).find((n) => n.chainId === chainId)
    const label = net?.label
    return label && label !== chainId ? `${label} (${chainId})` : chainId
}

function unreported(expectedChainId: string): WalletNetworkError {
    return new WalletNetworkError(`Your wallet did not report its network — switch Adena to ${networkLabelForChain(expectedChainId)} and try again.`)
}

async function ask(call: (() => Promise<WalletReply>) | undefined, timeoutMs: number): Promise<WalletReply> {
    if (!call) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            call(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("wallet did not answer")), timeoutMs) }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/**
 * Ask the wallet for its current account and network and refuse unless both
 * point at `expectedChainId`. Throws a user-facing error; resolves with what
 * the wallet reported.
 *
 * GetAccount is required. GetNetwork is read when the wallet has it (older
 * Adena builds do not); when it reports a chain it must agree with the
 * account's, and when it reports an RPC that RPC must be trusted.
 */
export async function assertLiveWalletNetwork(
    expectedChainId: string = GNO_CHAIN_ID,
    opts: { timeoutMs?: number } = {},
): Promise<LiveWalletNetwork> {
    const adena = (window as unknown as { adena?: AdenaNetworkApi }).adena
    if (!adena || typeof adena.GetAccount !== "function") throw unreported(expectedChainId)
    const timeoutMs = opts.timeoutMs ?? LIVE_NETWORK_TIMEOUT_MS

    let account: WalletReply
    let network: WalletReply
    try {
        ;[account, network] = await Promise.all([
            ask(adena.GetAccount.bind(adena), timeoutMs),
            ask(typeof adena.GetNetwork === "function" ? adena.GetNetwork.bind(adena) : undefined, timeoutMs),
        ])
    } catch {
        throw unreported(expectedChainId)
    }
    if (!account || account.status === "failure" || network?.status === "failure") throw unreported(expectedChainId)

    const accountChain = text(account.data?.chainId)
    const networkChain = text(network?.data?.chainId)
    const rpcUrl = text(network?.data?.rpcUrl)
    const chainId = networkChain || accountChain
    const wanted = networkLabelForChain(expectedChainId)

    if (!chainId) throw unreported(expectedChainId)
    if (accountChain && networkChain && accountChain !== networkChain) {
        throw new WalletNetworkError(
            `Your wallet reports two different networks (account on ${networkLabelForChain(accountChain)}, network ${networkLabelForChain(networkChain)}) — ` +
            `switch Adena to ${wanted} and try again.`,
        )
    }
    if (chainId !== expectedChainId) {
        throw new WalletNetworkError(`Your wallet is on ${networkLabelForChain(chainId)}, but this page is on ${wanted} — switch Adena to ${wanted} and try again.`)
    }
    if (rpcUrl && !isTrustedRpcDomain(rpcUrl)) {
        throw new WalletNetworkError(`Your wallet is using an untrusted RPC (${rpcUrl}) — switch Adena to a trusted ${wanted} RPC and try again.`)
    }
    return { chainId, address: text(account.data?.address), rpcUrl }
}

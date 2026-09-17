/**
 * TxStatus — one status line for a DAO transaction: approve in the wallet,
 * wait for the block, then confirmed or failed. The transaction hash links to
 * an explorer only where one is known to index the chain; otherwise it is
 * shown as copyable text.
 */
import { GNO_CHAIN_ID } from "../../lib/config"
import { normalizeTxHashHex, txExplorerUrl } from "../../lib/txExplorerUrl"
import "../dao/dao-shell.css"

export type TxState =
    | { phase: "idle" }
    | { phase: "wallet" }
    | { phase: "block"; hash?: string }
    | { phase: "confirmed"; hash: string; message: string }
    | { phase: "failed"; message: string; hash?: string }

const TITLES: Record<Exclude<TxState["phase"], "idle">, string> = {
    wallet: "Approve the transaction in your wallet",
    block: "Waiting for the block",
    confirmed: "Confirmed",
    failed: "Failed",
}

export function TxStatus({ state, chainId = GNO_CHAIN_ID }: { state: TxState; chainId?: string }) {
    if (state.phase === "idle") return null
    const hash = "hash" in state ? state.hash : undefined
    const hex = hash ? normalizeTxHashHex(hash) ?? hash : undefined
    const link = hash ? txExplorerUrl(hash, chainId) : null
    return (
        <div
            className={`dao-tx-status dao-tx-status--${state.phase}`}
            role={state.phase === "failed" ? "alert" : "status"}
            aria-live="polite"
            data-phase={state.phase}
        >
            <strong>{TITLES[state.phase]}</strong>
            {(state.phase === "confirmed" || state.phase === "failed") && <span>{state.message}</span>}
            {hex && (
                <span className="dao-tx-status__hash">
                    Transaction{" "}
                    {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer">{hex}</a>
                    ) : (
                        <code title="Transaction hash">{hex}</code>
                    )}
                </span>
            )}
        </div>
    )
}

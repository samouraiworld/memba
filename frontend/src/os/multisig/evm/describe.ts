/**
 * A decoded Safe transaction (lib/chain/evm/safe/decode.ts) in words: a title
 * and a detail line with full addresses. Token amounts stay in base units
 * until the token's decimals are read (they are never guessed).
 *
 * @module os/multisig/evm/describe
 */
import type { DecodedTx, SafeSetting } from "../../../lib/chain/evm/safe/decode"

const WEI_PER_ETH = 10n ** 18n

/** Wei as ETH, exactly: no rounding, trailing zeros dropped. */
export function formatEth(wei: bigint): string {
    const sign = wei < 0n ? "-" : ""
    const abs = wei < 0n ? -wei : wei
    const whole = abs / WEI_PER_ETH
    const fraction = (abs % WEI_PER_ETH).toString().padStart(18, "0").replace(/0+$/, "")
    return `${sign}${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} ETH`
}

const SETTING_TEXT: Readonly<Record<SafeSetting, string>> = {
    addOwnerWithThreshold: "Add an owner",
    removeOwner: "Remove an owner",
    swapOwner: "Replace an owner",
    changeThreshold: "Change the threshold",
    enableModule: "Enable a module",
    disableModule: "Disable a module",
    setGuard: "Set a transaction guard",
    setModuleGuard: "Set a module guard",
    setFallbackHandler: "Set the fallback handler",
    changeMasterCopy: "Change the Safe's code",
}

export interface TxText {
    title: string
    detail: string
}

export function describeTx(tx: DecodedTx): TxText {
    switch (tx.kind) {
        case "native-transfer": return { title: `Send ${formatEth(tx.value)}`, detail: `to ${tx.to}` }
        case "erc20-transfer": return { title: "Send tokens", detail: `${tx.amount.toLocaleString("en-US")} base units of token ${tx.token} to ${tx.to}` }
        case "erc20-approve": return {
            title: tx.amount === 0n ? "Revoke a token approval" : tx.unlimited ? "Approve unlimited token spending" : "Approve token spending",
            detail: `${tx.unlimited ? "Any amount" : `${tx.amount.toLocaleString("en-US")} base units`} of token ${tx.token} for ${tx.spender}`,
        }
        case "safe-setting": return {
            title: SETTING_TEXT[tx.setting],
            detail: [...tx.addresses, ...(tx.threshold !== undefined ? [`threshold ${tx.threshold}`] : [])].join(" · ") + " · changes who controls this Safe",
        }
        case "no-op": return tx.severity === "normal"
            ? { title: "Rejection", detail: "An empty transaction to the Safe itself: it uses its nonce so that no other transaction with that nonce can run" }
            : { title: "Empty call", detail: `to ${tx.to}` }
        case "batch": return { title: `Batch of ${tx.calls.length}`, detail: tx.calls.map((c) => describeTx(c).title).join(" · ") }
        case "contract-call": return { title: "Contract call", detail: `${tx.to} · function ${tx.selector}${tx.value > 0n ? ` · ${formatEth(tx.value)}` : ""}` }
        case "delegatecall": return { title: "Runs another contract's code as this Safe", detail: `${tx.to}: it could take full control of the Safe` }
        case "undecodable": return { title: "Unreadable transaction", detail: `Memba can't read it (${tx.reason}). Don't sign what you can't read.` }
    }
}

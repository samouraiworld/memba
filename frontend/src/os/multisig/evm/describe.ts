/**
 * A decoded Safe transaction (lib/chain/evm/safe/decode.ts) in words: a title
 * and a detail line with full addresses. Token amounts stay in base units
 * until the token's decimals are read (they are never guessed).
 *
 * @module os/multisig/evm/describe
 */
import type { DecodedTx, SafeSetting } from "../../../lib/chain/evm/safe/decode"
import type { SafeActionReason } from "../../../lib/chain/evm/safe/create"

/** A base-unit amount with `decimals`, exactly: no rounding, trailing zeros dropped. */
export function formatUnits(value: bigint, decimals: number): string {
    const unit = 10n ** BigInt(decimals)
    const sign = value < 0n ? "-" : ""
    const abs = value < 0n ? -value : value
    const fraction = decimals > 0 ? (abs % unit).toString().padStart(decimals, "0").replace(/0+$/, "") : ""
    return `${sign}${(abs / unit).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`
}

/** A typed amount in base units, exactly, or why it can't be one. Never floating point. */
export function parseAmount(input: string, decimals: number): { ok: true; value: bigint } | { ok: false; error: string } {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(input.trim())
    if (!m) return { ok: false, error: "Enter a plain number, like 0.5, without signs or separators." }
    const fraction = m[2] ?? ""
    if (fraction.length > decimals) return { ok: false, error: decimals === 0 ? "This token has no decimals." : `At most ${decimals} decimal places.` }
    const value = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")
    if (value === 0n) return { ok: false, error: "Enter an amount above zero." }
    if (value >= 2n ** 256n) return { ok: false, error: "This amount is too large." }
    return { ok: true, value }
}

/** Wei as ETH, exactly: no rounding, trailing zeros dropped. */
export function formatEth(wei: bigint): string {
    return `${formatUnits(wei, 18)} ETH`
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

/** What a Safe setting change does, in words. */
export function settingText(setting: SafeSetting): string {
    return SETTING_TEXT[setting]
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

/** Why creating a Safe, or acting on one, stopped, and what to do. */
export type SafeAction = "create" | "propose" | "sign" | "execute"

const ACTION_NAME: Readonly<Record<SafeAction, string>> = { create: "create the Safe", propose: "propose this", sign: "sign this", execute: "execute this" }

export function actionErrorText(reason: SafeActionReason, network: string, action: SafeAction = "create"): string {
    switch (reason.code) {
        case "not-connected": return `Connect a wallet to ${ACTION_NAME[action]}.`
        case "wrong-chain": return `Your wallet is on another network. Switch it to ${network} and try again.`
        case "declined": return action === "propose" || action === "sign" ? "You declined in your wallet. Nothing was signed." : "You declined in your wallet. Nothing was sent."
        case "address-taken": return "A contract already exists at the address this Safe would have. Review again for a new address."
        case "unexpected-deployment": return `The deployment Memba built is not the Safe you asked for (${reason.detail}). Nothing was sent.`
        case "reverted": return reason.detail ? `${reason.detail} ${action === "create" ? "No Safe was created." : "Nothing moved."}`
            : action === "create" ? "The creation transaction failed on chain. No Safe was created; only its gas was spent."
            : "The transaction failed on chain: nothing moved, only its gas was spent."
        case "not-the-safe": return "The transaction went through, but the address does not hold the Safe you asked for. Don't send funds to it."
        case "unconfirmed": return reason.detail ?? `Sent, but ${network} hasn't confirmed it yet. Don't send it again: check again in a moment.`
        case "unverified": return `Confirmed, but Memba couldn't read ${network} to check the result yet. Check again in a moment.`
        case "failed": return `Couldn't ${ACTION_NAME[action]}: ${reason.detail}`
        case "unexpected-transaction": return `Memba won't ${ACTION_NAME[action]}: ${reason.detail}. Nothing was signed.`
        case "hash-mismatch": return "This transaction's hash doesn't match its contents. Nothing was signed: don't sign it elsewhere either."
        case "not-owner": return "This wallet is not an owner of this Safe."
        case "not-ready": return `It can't run yet: ${reason.detail}.`
        case "contract-signer": return "This wallet is a smart account (a contract). In this version, Safe owners sign with a key-holder wallet such as MetaMask or Rabby."
        case "service": return `The Safe Transaction Service refused it: ${reason.detail}`
    }
}

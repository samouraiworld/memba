/**
 * Every call of a Safe transaction, in full, before an owner signs it: each
 * address in its EIP-55 spelling in groups of four, token amounts in the
 * token's own decimals with its address (any token can call itself "ETH"),
 * the address-poisoning warnings on each recipient, and the raw data of any
 * call Memba can't name. A batch shows each of its calls, never only titles.
 *
 * `ready` is false until every line is drawn (token reads included), and
 * `needsAck` says when an owner must confirm they checked it with the others
 * (Safe settings, unnamed contract calls, approvals, unreadable tokens,
 * look-alike recipients).
 *
 * @module os/multisig/evm/lineModel
 */
import { useQuery } from "@tanstack/react-query"
import { EVM_ENABLED } from "../../../lib/chain/flag"
import type { DecodedTx } from "../../../lib/chain/evm/safe/decode"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import { knownRecipients, recipientWarnings, type KnownRecipient } from "../../../lib/chain/evm/safe/recipients"
import { describeTx, formatEth, formatUnits, settingText } from "./describe"
import type { SafeNetwork } from "./useSafes"

export interface LineView {
    title: string
    rows: { label: string; value: string; address?: boolean; data?: boolean }[]
    notes: { severity: "danger" | "caution"; text: string }[]
    needsAck: boolean
}

const TOKEN_NAME_NOTE = "Any token can take any name, ETH included: check the token's address."

type Sdk = Awaited<ReturnType<typeof loadSafeSdk>>

async function lineFor(sdk: Sdk, networkKey: string, safe: string, known: readonly KnownRecipient[], tx: DecodedTx): Promise<LineView> {
    const full = (a: string) => sdk.toChecksum(a)
    const recipient = async (to: string, token?: string) => {
        const contract = await sdk.isContract(networkKey, to)
        return recipientWarnings(to as `0x${string}`, { safe, token, known, isContract: contract.kind === "ok" ? contract.value : undefined })
            .map((w) => ({ severity: w.severity, text: w.text }))
    }
    switch (tx.kind) {
        case "native-transfer": {
            const notes = await recipient(tx.to)
            return { title: `Send ${formatEth(tx.value)}`, rows: [{ label: "To", value: full(tx.to), address: true }], notes, needsAck: notes.some((n) => n.severity === "danger") }
        }
        case "erc20-transfer":
        case "erc20-approve": {
            const info = await sdk.readToken(networkKey, tx.token)
            const party = tx.kind === "erc20-transfer" ? tx.to : tx.spender
            const amount = info.kind === "ok" ? `${formatUnits(tx.amount, info.value.decimals)} ${info.value.symbol}` : `${tx.amount.toLocaleString("en-US")} base units of an unreadable token`
            const notes = [
                ...(tx.kind === "erc20-transfer" ? await recipient(tx.to, tx.token) : []),
                info.kind === "ok" ? { severity: "caution" as const, text: TOKEN_NAME_NOTE } : { severity: "danger" as const, text: `Memba couldn't read this token (${info.reason}): the amount is in its smallest unit.` },
            ]
            const approve = tx.kind === "erc20-approve"
            return {
                title: approve ? (tx.amount === 0n ? `Revoke the token allowance` : `Allow spending ${tx.unlimited ? "any amount of" : ""} ${tx.unlimited && info.kind === "ok" ? info.value.symbol : amount}`.replace(/\s+/g, " ")) : `Send ${amount}`,
                rows: [{ label: "Token", value: full(tx.token), address: true }, { label: approve ? "Spender" : "To", value: full(party), address: true }],
                notes: approve && tx.amount !== 0n ? [{ severity: "caution" as const, text: "The spender can then move these tokens out of the Safe without the owners." }, ...notes] : notes,
                needsAck: (approve && tx.amount !== 0n) || info.kind !== "ok" || notes.some((n) => n.severity === "danger"),
            }
        }
        case "safe-setting":
            return {
                title: settingText(tx.setting),
                rows: [...tx.addresses.map((a, i) => ({ label: tx.addresses.length > 1 ? `Address ${i + 1}` : "Address", value: full(a), address: true })),
                    ...(tx.threshold !== undefined ? [{ label: "Signatures needed", value: tx.threshold.toString() }] : [])],
                notes: [{ severity: "danger", text: "This changes who controls the Safe." }],
                needsAck: true,
            }
        case "contract-call":
            return {
                title: "Contract call",
                rows: [{ label: "Contract", value: full(tx.to), address: true }, { label: "Function", value: tx.selector },
                    ...(tx.value > 0n ? [{ label: "Sends", value: formatEth(tx.value) }] : []), { label: "Data", value: tx.data, data: true }],
                notes: [{ severity: "caution", text: "Memba can't tell what this call does. Check it with whoever proposed it." }],
                needsAck: true,
            }
        case "no-op":
            return { title: describeTx(tx).title, rows: [{ label: "To", value: full(tx.to), address: true }], notes: [], needsAck: false }
        case "batch":
            throw new Error("batches are drawn call by call")
        case "delegatecall":
        case "undecodable":
            return { title: describeTx(tx).title, rows: [{ label: "Contract", value: tx.to === "0x" ? "unreadable" : full(tx.to), address: tx.to !== "0x" }, { label: "Data", value: tx.data, data: true }], notes: [{ severity: "danger", text: describeTx(tx).detail }], needsAck: true }
    }
}

/** The lines of a decoded transaction, each call of a batch on its own. */
/** A decoded transaction as a stable text (bigints as decimal strings), for cache keys. */
function bodyKey(decoded: DecodedTx): string {
    return JSON.stringify(decoded, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))
}

/**
 * The lines of a queued transaction, drawn only when its contents match its
 * hash, and cached by hash and contents together: two listings with the same
 * hash and other contents never share lines.
 */
export function useTxLines(net: SafeNetwork, safe: string, owners: readonly string[], tx: { safeTxHash: string; hashMatches: boolean; decoded: DecodedTx }) {
    const decoded = tx.decoded
    return useQuery({
        queryKey: ["safe", "lines", net.chainId, safe, tx.safeTxHash, bodyKey(decoded), owners.join(",")],
        enabled: EVM_ENABLED && tx.hashMatches,
        staleTime: Infinity,
        queryFn: async (): Promise<LineView[]> => {
            const sdk = await loadSafeSdk()
            // Only the owners are known recipients: the Transaction Service's history is not proof of who was paid.
            const known = knownRecipients({ owners })
            const calls = decoded.kind === "batch" ? decoded.calls : [decoded]
            return Promise.all(calls.map((c) => lineFor(sdk, net.key, safe, known, c)))
        },
    })
}

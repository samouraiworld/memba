import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID } from "../../lib/config"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { depositCapUgnot, formatUgnotExact } from "../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { profilePublishCosts, profileStorageBytes, type StoredValueChange } from "./profileBudget"
import { CORE_FIELDS, CORE_LIMITS, encodeProfileDocument, PROFILE_DOCUMENT_FIELD, PROFILE_REALM, readProfileOnChain, safeProfileUrl, type ProfileChainRead, type ProfileCore, type ProfileDocument } from "./profileData"

export interface ProfileDraft { core: Record<keyof ProfileCore, string>; document: ProfileDocument }
export interface ProfileChange extends StoredValueChange { field: string }

/** The custom key was verified in the deployed mainnet source. Other realm copies reject it. */
export const canPublishProfileDocument = ACTIVE_NETWORK_KEY === "mainnet" && PROFILE_REALM === "gno.land/r/demo/profile"
/** Enable only after the owner completes a live wallet/gas rehearsal. */
export const profilePublishEnabled = import.meta.env.VITE_ENABLE_OS_PROFILE_PUBLISH === "true"

export function validateProfileDraft(draft: ProfileDraft): void {
    for (const key of Object.keys(CORE_FIELDS) as (keyof ProfileCore)[]) {
        const value = draft.core[key]
        if (typeof value !== "string" || [...value].length > CORE_LIMITS[key] || [...value].some((char) => {
            const code = char.codePointAt(0) ?? 0
            return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127
        })) {
            throw new Error(`${key} is too long or contains unsupported characters.`)
        }
    }
    for (const key of ["avatar", "homepage"] as const) {
        if (draft.core[key] && !safeProfileUrl(draft.core[key])) throw new Error(`${key} must be a valid https URL.`)
    }
    encodeProfileDocument(draft.document)
}

export function draftFromChain(chain: ProfileChainRead): ProfileDraft {
    return {
        core: Object.fromEntries((Object.keys(CORE_FIELDS) as (keyof ProfileCore)[]).map((key) => [key, chain.core[key] ?? ""])) as ProfileDraft["core"],
        document: structuredClone(chain.document),
    }
}

export function profileChanges(base: ProfileChainRead, draft: ProfileDraft): ProfileChange[] {
    validateProfileDraft(draft)
    const changes: ProfileChange[] = (Object.keys(CORE_FIELDS) as (keyof ProfileCore)[])
        .filter((key) => draft.core[key] !== (base.core[key] ?? ""))
        .map((key) => ({ field: CORE_FIELDS[key], before: base.core[key] ?? "", after: draft.core[key], created: base.core[key] === null }))
    const afterDocument = encodeProfileDocument(draft.document)
    const beforeDocument = encodeProfileDocument(base.document)
    if (afterDocument !== beforeDocument) {
        if (!canPublishProfileDocument) throw new Error("This network's profile realm does not support saved layouts and extra fields.")
        changes.push({ field: PROFILE_DOCUMENT_FIELD, before: base.documentPresent ? beforeDocument : "", after: afterDocument, created: !base.documentPresent })
    }
    return changes
}

export function profileMessages(address: string, changes: ProfileChange[]): AminoMsg[] {
    if (!isValidGnoAddressChecksum(address)) throw new Error("Invalid wallet address.")
    return changes.map((change) => ({
        type: "vm/MsgCall",
        value: {
            caller: address, send: "", pkg_path: PROFILE_REALM, func: "SetStringField", args: [change.field, change.after],
            max_deposit: `${depositCapUgnot(profileStorageBytes(change))}ugnot`,
        },
    }))
}

function currentValue(chain: ProfileChainRead, field: string): string {
    if (field === PROFILE_DOCUMENT_FIELD) return chain.documentPresent ? encodeProfileDocument(chain.document) : ""
    const key = (Object.keys(CORE_FIELDS) as (keyof ProfileCore)[]).find((item) => CORE_FIELDS[item] === field)
    return key ? chain.core[key] ?? "" : ""
}

/** Locks an unknown/submitted outcome across remounts until a fresh read is explicitly reviewed. */
export function profileLockKey(address: string): string { return `memba_profile_publish:${GNO_CHAIN_ID}:${address}` }

export function profilePublishRequest(address: string, base: ProfileChainRead, draft: ProfileDraft, price: GasPrice, onSettled: (outcome: string) => void): SignRequest {
    const changes = profileChanges(base, draft)
    if (!changes.length) throw new Error("There are no changes to publish.")
    const msgs = profileMessages(address, changes)
    const costs = profilePublishCosts(changes, price)
    const key = profileLockKey(address)
    return {
        title: "Publish profile",
        summary: `Publish ${changes.length} public profile change${changes.length === 1 ? "" : "s"}`,
        sub: `For ${address}`,
        lines: () => [
            ["Account", address], ["Network", GNO_CHAIN_ID], ["Realm", PROFILE_REALM],
            ...changes.map((change): [string, string] => [change.field, change.after || "(clear)"]),
            ["Storage deposit", `≈ ${formatUgnotExact(costs.depositUgnot)} (cap ${formatUgnotExact(costs.depositCapUgnot)})`],
            ["Network fee", formatUgnotExact(costs.feeUgnot)],
        ],
        warns: ["Profile text, links and image URLs are public on chain. Hiding a section in Memba does not hide its underlying chain data."],
        acks: ["I understand these changes are public and require a wallet transaction."],
        note: "Adena shows one contract call per changed field. The storage deposit is locked on chain: shortening or clearing a field returns only the bytes removed, and about 0.21 GNOT per field stays locked for good.",
        label: () => "Publish profile",
        prepare: () => ({ msgs }),
        recheck: async () => {
            const fresh = await readProfileOnChain(address)
            if (fresh.missingCore.length || fresh.documentProblem) throw new Error("The current profile could not be verified. Nothing was sent.")
            if (changes.some(({ field, before }) => currentValue(fresh, field) !== before)) throw new Error("Your published profile changed. Reload it and review the draft before publishing.")
            await assertFeeStillCovers(costs.feeUgnot, () => freshFeeForGasWanted(costs.gasWanted))
        },
        send: async (_choice, beforeSign) => {
            localStorage.setItem(key, JSON.stringify({ at: Date.now(), changes, draft: JSON.stringify(draft) }))
            return doContractBroadcast(msgs, "Memba profile", { gasWanted: costs.gasWanted, gasFee: costs.feeUgnot, retry: false, beforeSign })
        },
        verify: async () => {
            const fresh = await readProfileOnChain(address)
            return changes.every(({ field, after }) => currentValue(fresh, field) === after)
        },
        onNothingSent: () => localStorage.removeItem(key),
        onSettled: (outcome) => {
            if (outcome === "confirmed") localStorage.removeItem(key)
            onSettled(outcome)
        },
    }
}

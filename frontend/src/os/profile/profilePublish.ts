import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID } from "../../lib/config"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { resolveAvatarUrl } from "../../lib/ipfs"
import type { UserProfile } from "../../lib/profile"
import { depositCapUgnot, formatUgnotExact } from "../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { profilePublishCosts, profileStorageBytes, type StoredValueChange } from "./profileBudget"
import { CORE_FIELDS, CORE_LIMITS, encodeProfileDocument, layoutLocked, PROFILE_DOCUMENT_FIELD, PROFILE_REALM, readProfileOnChain, safeProfileUrl, type ProfileChainRead, type ProfileCore, type ProfileDocument } from "./profileData"
import { withFeeCheck } from "../sign/recheck"

export interface ProfileDraft { core: Record<keyof ProfileCore, string>; document: ProfileDocument }
export interface ProfileChange extends StoredValueChange {
    field: string
    /** The stored value is one Memba cannot show, so the call replaces it whatever it holds. Only a value its owner entered does this. */
    repair: boolean
}

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

/**
 * An empty Bio shows the owner's earlier Memba or GitHub bio when there is one, so clearing a
 * published Bio cannot empty it: the clear is not published, and not charged for. It is held
 * too while it is not known whether there is one (`bioFallback` null: those sources have not
 * answered).
 */
export function bioClearHeld(base: ProfileChainRead, draft: ProfileDraft, bioFallback: boolean | null): boolean {
    return bioFallback !== false && !!base.core.bio && draft.core.bio === ""
}

/**
 * The calls a publish makes: one per value the owner changed. A stored value Memba cannot show
 * (over a limit, or not a valid layout) is touched only when its owner entered a replacement,
 * never alongside another edit; a layout saved under a later version is never written.
 */
export function profileChanges(base: ProfileChainRead, draft: ProfileDraft, bioFallback: boolean | null = false): ProfileChange[] {
    validateProfileDraft(draft)
    const changes: ProfileChange[] = (Object.keys(CORE_FIELDS) as (keyof ProfileCore)[])
        .filter((key) => draft.core[key] !== (base.core[key] ?? "") && !(key === "bio" && bioClearHeld(base, draft, bioFallback)))
        .map((key) => {
            const repair = base.invalidCore.includes(key)
            return { field: CORE_FIELDS[key], before: base.core[key] ?? "", after: draft.core[key], created: base.core[key] === null && !repair, repair }
        })
    const afterDocument = encodeProfileDocument(draft.document)
    const beforeDocument = encodeProfileDocument(base.document)
    if (afterDocument !== beforeDocument) {
        if (!canPublishProfileDocument) throw new Error("This network's profile realm does not support saved layouts and extra fields.")
        // Reloading brings a newer Memba, which helps only with a layout a newer version saved.
        if (layoutLocked(base)) throw new Error(base.documentOversize
            ? "Your saved layout is too large for this version of Memba to read, so it cannot change it."
            : "Your layout was saved by a newer version of Memba, so this version cannot change it. Reload Memba to edit your layout.")
        changes.push({ field: PROFILE_DOCUMENT_FIELD, before: base.documentPresent ? beforeDocument : "", after: afterDocument, created: !base.documentPresent && !base.documentInvalid, repair: base.documentInvalid })
    }
    return changes
}

/**
 * Moves a draft made on one read (`was`, as `draftFromChain` gives it) onto another (`now`): what
 * its owner did not touch follows the chain, what they edited stays. A layout this version must
 * not write (`lockLayout`) is never kept from the draft.
 */
export function rebaseDraft(draft: ProfileDraft, was: ProfileDraft, now: ProfileDraft, lockLayout = false): ProfileDraft {
    const keys = Object.keys(CORE_FIELDS) as (keyof ProfileCore)[]
    return {
        core: Object.fromEntries(keys.map((key) => [key, draft.core[key] === was.core[key] ? now.core[key] : draft.core[key]])) as ProfileDraft["core"],
        document: lockLayout || JSON.stringify(draft.document) === JSON.stringify(was.document) ? structuredClone(now.document) : draft.document,
    }
}

/**
 * Copies legacy Memba details into fields that were never set on chain, and into a Bio that is
 * empty there. It never replaces a stored value, including one Memba cannot show.
 */
export function importLegacyProfile(draft: ProfileDraft, base: ProfileChainRead, legacy: UserProfile): ProfileDraft {
    const next = structuredClone(draft)
    const unset = (key: keyof ProfileCore) => base.core[key] === null && !base.invalidCore.includes(key)
    // Wallet activation writes an empty Bio, so an empty Bio counts as unpublished.
    if ((unset("bio") || base.core.bio === "") && legacy.bio) next.core.bio = legacy.bio.slice(0, CORE_LIMITS.bio)
    const avatar = safeProfileUrl(resolveAvatarUrl(legacy.avatarUrl))
    if (unset("avatar") && avatar) next.core.avatar = avatar
    const homepage = safeProfileUrl(legacy.socialLinks.website)
    if (unset("homepage") && homepage) next.core.homepage = homepage
    if (!base.documentPresent && !base.documentInvalid && !layoutLocked(base) && canPublishProfileDocument) {
        next.document.title = legacy.title.slice(0, 128)
        next.document.company = legacy.company.slice(0, 128)
        const social = [
            { label: "GitHub", value: legacy.socialLinks.github, host: "github.com" },
            { label: "X", value: legacy.socialLinks.twitter, host: "x.com" },
        ]
        next.document.links = social.flatMap(({ label, value, host }) => {
            if (!value) return []
            const handle = value.replace(/^@/, "")
            const candidate = value.startsWith("https://") ? value : /^[A-Za-z0-9_.-]{1,64}$/.test(handle) ? `https://${host}/${handle}` : ""
            const url = safeProfileUrl(candidate)
            return url && new URL(url).hostname === host ? [{ label, url }] : []
        }).slice(0, 5)
    }
    return next
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

function needsRepair(chain: ProfileChainRead, field: string): boolean {
    return field === PROFILE_DOCUMENT_FIELD ? chain.documentInvalid : chain.invalidCore.some((key) => CORE_FIELDS[key] === field)
}

/** A partial read cannot confirm or rule out a change. */
export function profileReadIncomplete(chain: ProfileChainRead): boolean {
    return chain.missingCore.length > 0 || chain.documentUnreadable
}

/** The changes the chain does not show yet. */
export function unpublishedChanges<T extends Pick<ProfileChange, "field" | "after">>(chain: ProfileChainRead, changes: readonly T[]): T[] {
    return changes.filter(({ field, after }) => needsRepair(chain, field) || currentValue(chain, field) !== after)
}

/** Locks an unknown/submitted outcome across remounts until a fresh read is explicitly reviewed. */
export function profileLockKey(address: string): string { return `memba_profile_publish:${GNO_CHAIN_ID}:${address}` }

/** The label of a sheet line that replaces a stored value Memba cannot show. */
export const REPAIR_LINE = "replaces the value stored on chain, which Memba cannot show"

export function profilePublishRequest(address: string, base: ProfileChainRead, draft: ProfileDraft, price: GasPrice, onSettled: (outcome: string) => void, bioFallback: boolean | null = false): SignRequest {
    const changes = profileChanges(base, draft, bioFallback)
    if (!changes.length) throw new Error("There are no changes to publish.")
    const msgs = profileMessages(address, changes)
    const costs = profilePublishCosts(changes, price)
    const key = profileLockKey(address)
    const repairs = changes.filter((change) => change.repair).map((change) => change.field)
    return {
        title: "Publish profile",
        summary: `Publish ${changes.length} public profile change${changes.length === 1 ? "" : "s"}`,
        sub: `For ${address}`,
        lines: () => [
            ["Account", address], ["Network", GNO_CHAIN_ID], ["Realm", PROFILE_REALM],
            ...changes.map((change): [string, string] => [change.repair ? `${change.field} (${REPAIR_LINE})` : change.field, change.after || "(clear)"]),
            // The length of a replaced value is unknown, and the chain refunds what it frees: the estimate is a ceiling for it.
            ["Storage deposit", `${repairs.length ? "at most" : "≈"} ${formatUgnotExact(costs.depositUgnot)} (cap ${formatUgnotExact(costs.depositCapUgnot)})`],
            ["Network fee", formatUgnotExact(costs.feeUgnot)],
        ],
        warns: [
            "Profile text, links and image URLs are public on chain. Hiding a section in Memba does not hide its underlying chain data.",
            ...(repairs.length ? [`${repairs.join(", ")}: the value stored on chain is too long for Memba, or not a layout it can read, so Memba does not show it. Publishing replaces it for every app that reads this profile.`] : []),
        ],
        acks: [
            "I understand these changes are public and require a wallet transaction.",
            ...(repairs.length ? [`I understand this replaces what is stored on chain for ${repairs.join(", ")}.`] : []),
        ],
        note: "Adena shows one contract call per changed field. The storage deposit is locked on chain: shortening or clearing a field returns only the bytes removed, and about 0.21 GNOT per field stays locked for good.",
        label: () => "Publish profile",
        prepare: () => ({ msgs }),
        recheck: async () => {
            await withFeeCheck(readProfileOnChain(address), assertFeeStillCovers(costs.feeUgnot, () => freshFeeForGasWanted(costs.gasWanted)), (fresh) => {
                if (profileReadIncomplete(fresh)) throw new Error("The current profile could not be verified. Nothing was sent.")
                const layoutNowLocked = layoutLocked(fresh) && changes.some(({ field }) => field === PROFILE_DOCUMENT_FIELD)
                if (layoutNowLocked || changes.some(({ field, before, repair }) => needsRepair(fresh, field) !== repair || (!repair && currentValue(fresh, field) !== before))) throw new Error("Your published profile changed. Reload it and review the draft before publishing.")
            })
        },
        send: async (_choice, beforeSign) => {
            localStorage.setItem(key, JSON.stringify({ at: Date.now(), changes, draft: JSON.stringify(draft) }))
            return doContractBroadcast(msgs, "Memba profile", { gasWanted: costs.gasWanted, gasFee: costs.feeUgnot, beforeSign })
        },
        // A read that missed a field confirms nothing about it: the outcome stays unknown and the publish locked.
        verify: async () => {
            const chain = await readProfileOnChain(address)
            return !profileReadIncomplete(chain) && unpublishedChanges(chain, changes).length === 0
        },
        onNothingSent: () => localStorage.removeItem(key),
        onSettled: (outcome) => {
            if (outcome === "confirmed") localStorage.removeItem(key)
            onSettled(outcome)
        },
    }
}

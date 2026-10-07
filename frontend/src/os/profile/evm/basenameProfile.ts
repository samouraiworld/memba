/**
 * A Basename profile in the Profile app's shape (ProfileChainRead), so the same canvas shows a Base account.
 * Pure: the reads are lib/chain/evm/basenames.ts. Field mapping (ENSIP-5 keys):
 *   displayName = the primary Basename · bio = description · avatar = avatar · homepage = url · location = location
 *   layout document = the "memba.profile.v1" text record, the same JSON as the Gno profile field.
 * Title and company stay in the layout document; X and GitHub come from com.twitter / com.github.
 *
 * @module os/profile/evm/basenameProfile
 */
import type { BasenameTextKey, PrimaryBasename } from "../../../lib/chain/evm/basenames"
import {
    CORE_FIELDS,
    CORE_LIMITS,
    defaultProfileDocument,
    parseProfileDocument,
    safeProfileUrl,
    storedLayoutVersion,
    type CoreField,
    type ProfileChainRead,
    type ProfileCore,
} from "../profileData"

const TEXT_FOR: Readonly<Record<Exclude<CoreField, "displayName">, BasenameTextKey>> = {
    bio: "description",
    avatar: "avatar",
    homepage: "url",
    location: "location",
}

/**
 * The profile of an account from its proven primary name and that name's text records (null: not read).
 * An account without a Basename has an empty profile, with nothing missing: there is nothing to read.
 */
export function basenameChainRead(primary: PrimaryBasename | null, texts: Record<BasenameTextKey, string | null> | null): ProfileChainRead {
    const core = Object.fromEntries((Object.keys(CORE_FIELDS) as CoreField[]).map((k) => [k, null])) as ProfileCore
    const missingCore: CoreField[] = []
    const invalidCore: CoreField[] = []
    if (primary) {
        core.displayName = [...primary.name].length <= CORE_LIMITS.displayName ? primary.name : null
        for (const [field, key] of Object.entries(TEXT_FOR) as [Exclude<CoreField, "displayName">, BasenameTextKey][]) {
            const value = texts ? texts[key] : null
            if (value === null) missingCore.push(field)
            else if (value === "") core[field] = null // ENS has no "absent": an unset record reads ""
            else if ([...value].length <= CORE_LIMITS[field]) core[field] = value
            else invalidCore.push(field)
        }
    }
    const raw = primary && texts ? texts["memba.profile.v1"] : ""
    const parsed = raw ? parseProfileDocument(raw) : null
    const documentNewer = !!raw && !parsed && (storedLayoutVersion(raw) ?? 0) > 1
    return {
        core,
        document: parsed ?? defaultProfileDocument(),
        documentPresent: !!parsed,
        documentUnreadable: !!primary && raw === null,
        documentInvalid: !!raw && !parsed && !documentNewer,
        documentNewer,
        documentOversize: false,
        missingCore,
        invalidCore,
    }
}

/** X and GitHub links from the ENSIP-5 service keys (a handle or an https URL), safe URLs only. */
export function basenameLinks(texts: Record<BasenameTextKey, string | null> | null): { label: string; url: string }[] {
    const links: { label: string; url: string }[] = []
    const add = (label: string, value: string | null | undefined, host: string) => {
        if (!value) return
        const url = safeProfileUrl(value.startsWith("https://") ? value : `https://${host}/${value.replace(/^@/, "")}`)
        if (url) links.push({ label, url })
    }
    add("X", texts?.["com.twitter"], "x.com")
    add("GitHub", texts?.["com.github"], "github.com")
    return links
}

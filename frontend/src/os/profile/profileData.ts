/** Public profile reads from the deployed caller-keyed profile realm. */
import { activationRealmFor, ACTIVE_NETWORK_KEY } from "../../lib/config"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { assertActiveRpcChain } from "../../lib/dao/chainIdentity"
import { decodeGoQuoted } from "../../lib/goQuote"
import { resilientAbciQuery } from "../../lib/rpcFallback"

export const PROFILE_DOCUMENT_FIELD = "memba.profile.v1"
export const PROFILE_REALM = activationRealmFor(ACTIVE_NETWORK_KEY)
const ABSENT = "__memba_profile_absent_7c4d93a3__"
export const CORE_FIELDS = {
    displayName: "DisplayName",
    bio: "Bio",
    avatar: "Avatar",
    homepage: "Homepage",
    location: "Location",
} as const

/** Limits also apply to untrusted chain reads before they reach a public view. */
export const CORE_LIMITS = { displayName: 80, bio: 500, avatar: 256, homepage: 256, location: 100 } as const

export type CoreField = keyof typeof CORE_FIELDS
/** null means the key has never been set; "" was written, by a clear or, for Bio, by wallet activation. */
export type ProfileCore = Record<CoreField, string | null>
export type ProfileTemplate = "simple" | "builder" | "community"
export type ProfileAccent = "indigo" | "teal" | "rose" | "amber"
export type ProfileSection = "about" | "links" | "daos" | "votes" | "assets" | "credentials" | "feed" | "reviews"
export interface ProfileLink { label: string; url: string }
export interface ProfileDocument {
    version: 1
    template: ProfileTemplate
    accent: ProfileAccent
    title: string
    company: string
    cover: string
    links: ProfileLink[]
    sections: ProfileSection[]
    hidden: ProfileSection[]
}

export const ALL_SECTIONS: readonly ProfileSection[] = ["about", "links", "daos", "votes", "assets", "credentials", "feed", "reviews"]
export const SECTION_LABELS: Record<ProfileSection, string> = {
    about: "About", links: "Links", daos: "Memberships and roles", votes: "Governance votes", assets: "Public assets", credentials: "Credentials", feed: "Feed activity", reviews: "Reviews",
}
export type ProfileTab = "overview" | "home" | "daos" | "contributions" | "feed"
export const TAB_NAMES: Record<ProfileTab, string> = { overview: "Overview", home: "Home", daos: "DAOs", contributions: "Contributions", feed: "Feed" }
/** The tab each section is shown in. A section's position only matters among the sections of its tab. */
export const SECTION_TAB: Record<ProfileSection, "overview" | "daos" | "feed"> = {
    about: "overview", links: "overview", assets: "overview", credentials: "overview", reviews: "overview", daos: "daos", votes: "daos", feed: "feed",
}
/** A template is what a visitor meets after the overview, plus one column (simple) or two. */
export const TEMPLATE_TABS: Record<ProfileTemplate, readonly ProfileTab[]> = {
    simple: ["overview", "home", "daos", "contributions", "feed"],
    builder: ["overview", "contributions", "home", "daos", "feed"],
    community: ["overview", "daos", "feed", "home", "contributions"],
}
const TEMPLATES: readonly ProfileTemplate[] = ["simple", "builder", "community"]
const ACCENTS: readonly ProfileAccent[] = ["indigo", "teal", "rose", "amber"]
const MAX_DOCUMENT_BYTES = 4096
const MAX_QEVAL_CHARS = 24_000

export function defaultProfileDocument(): ProfileDocument {
    return { version: 1, template: "simple", accent: "indigo", title: "", company: "", cover: "", links: [], sections: [...ALL_SECTIONS], hidden: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validText(value: unknown, max: number): value is string {
    return typeof value === "string" && [...value].length <= max && ![...value].some((char) => {
        const code = char.codePointAt(0) ?? 0
        return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127
    })
}

export function safeProfileUrl(value: unknown): string | null {
    if (!validText(value, 256) || !value || /\s/.test(value)) return null
    try {
        const url = new URL(value)
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null
        return url.href.length <= 256 ? url.href : null
    } catch { return null }
}

/** The version of a stored layout that parses as one, whatever else it holds; null otherwise. */
function storedLayoutVersion(raw: string): number | null {
    try {
        const value: unknown = JSON.parse(raw)
        return isRecord(value) && typeof value.version === "number" ? value.version : null
    } catch { return null }
}

/** Unknown, malformed or oversized values are never applied as visual settings. */
export function parseProfileDocument(raw: string): ProfileDocument | null {
    if (new TextEncoder().encode(raw).length > MAX_DOCUMENT_BYTES) return null
    let value: unknown
    try { value = JSON.parse(raw) } catch { return null }
    if (!isRecord(value) || value.version !== 1 || !TEMPLATES.includes(value.template as ProfileTemplate) || !ACCENTS.includes(value.accent as ProfileAccent)) return null
    if (!validText(value.title, 128) || !validText(value.company, 128)) return null
    if (typeof value.cover !== "string" || (value.cover !== "" && safeProfileUrl(value.cover) === null)) return null
    if (!Array.isArray(value.links) || value.links.length > 5 || !value.links.every((link) => isRecord(link) && validText(link.label, 40) && link.label.trim() && safeProfileUrl(link.url))) return null
    if (!Array.isArray(value.sections) || value.sections.length !== ALL_SECTIONS.length || new Set(value.sections).size !== ALL_SECTIONS.length || !value.sections.every((s) => ALL_SECTIONS.includes(s))) return null
    if (!Array.isArray(value.hidden) || new Set(value.hidden).size !== value.hidden.length || !value.hidden.every((s) => ALL_SECTIONS.includes(s))) return null
    return {
        version: 1, template: value.template as ProfileTemplate, accent: value.accent as ProfileAccent,
        title: value.title, company: value.company, cover: value.cover,
        links: value.links.map((link: Record<string, unknown>) => ({ label: (link.label as string).trim(), url: safeProfileUrl(link.url)! })),
        sections: value.sections as ProfileSection[], hidden: value.hidden as ProfileSection[],
    }
}

export function encodeProfileDocument(document: ProfileDocument): string {
    const raw = JSON.stringify(document)
    const parsed = parseProfileDocument(raw)
    if (!parsed) throw new Error("Profile layout is invalid or too large to publish.")
    return JSON.stringify(parsed)
}

/** Gno vm/qeval returns `(\"<Go quoted value>\" string)`, including Unicode escapes JSON cannot decode. */
export function parseProfileString(raw: string | null): string | null {
    if (raw === null || raw.length > MAX_QEVAL_CHARS) return null
    const match = raw.match(/^\(\s*("[\s\S]*")\s+string\s*\)\s*$/)
    if (!match) return null
    try { return decodeGoQuoted(match[1]) } catch { return null }
}

/** The chain answered with a string too long to decode: a stored value exists and Memba cannot use it. */
const OVERSIZE = Symbol("oversize")

async function readField(address: string, field: string): Promise<string | null | typeof OVERSIZE> {
    const expression = `${PROFILE_REALM}.GetStringField(address(${JSON.stringify(address)}), ${JSON.stringify(field)}, ${JSON.stringify(ABSENT)})`
    const raw = await resilientAbciQuery("vm/qeval", expression, true)
    if (raw !== null && raw.length > MAX_QEVAL_CHARS && /^\(\s*"/.test(raw) && /"\s+string\s*\)\s*$/.test(raw)) return OVERSIZE
    const value = parseProfileString(raw)
    if (value === null) throw new Error(`Couldn't read ${field} from the profile realm.`)
    return value === ABSENT ? null : value
}

export interface ProfileChainRead {
    core: ProfileCore
    document: ProfileDocument
    documentPresent: boolean
    /** The chain did not answer for the layout. A missing layout is normal and sets neither flag. */
    documentUnreadable: boolean
    /** A layout is stored but is not one this version reads (malformed, over the size cap, or not a valid v1 document): its values are not applied, and its owner can replace it. */
    documentInvalid: boolean
    /** A layout is stored under a later version number: its values are not applied, and this version never writes over it. */
    documentNewer: boolean
    /** A layout is stored whose answer is too long to decode, so its version cannot be checked: treated like a newer one. */
    documentOversize: boolean
    /** Fields the chain did not answer for. */
    missingCore: CoreField[]
    /** Fields stored over Memba's limit: never shown, and replaceable by their owner. */
    invalidCore: CoreField[]
}

export async function readProfileOnChain(address: string): Promise<ProfileChainRead> {
    if (!isValidGnoAddressChecksum(address)) throw new Error("Invalid profile address.")
    await assertActiveRpcChain()
    const keys = Object.keys(CORE_FIELDS) as CoreField[]
    const results = await Promise.allSettled([...keys.map((key) => readField(address, CORE_FIELDS[key])), readField(address, PROFILE_DOCUMENT_FIELD)])
    const core = {} as ProfileCore
    const missingCore: CoreField[] = []
    const invalidCore: CoreField[] = []
    keys.forEach((key, index) => {
        const result = results[index]
        const value = result.status === "fulfilled" ? result.value : null
        core[key] = typeof value === "string" && [...value].length <= CORE_LIMITS[key] ? value : null
        if (result.status === "rejected") missingCore.push(key)
        else if (value !== null && core[key] === null) invalidCore.push(key)
    })
    if (missingCore.length === keys.length) throw new Error("The profile realm could not be read. Try again.")
    const layout = results[keys.length]
    const documentRaw = layout.status === "fulfilled" ? layout.value : null
    const parsed = typeof documentRaw === "string" && documentRaw ? parseProfileDocument(documentRaw) : null
    const documentNewer = typeof documentRaw === "string" && !parsed && (storedLayoutVersion(documentRaw) ?? 0) > 1
    const documentOversize = documentRaw === OVERSIZE
    return {
        core, document: parsed ?? defaultProfileDocument(), documentPresent: !!parsed,
        documentUnreadable: layout.status === "rejected", documentInvalid: !!documentRaw && !parsed && !documentNewer && !documentOversize, documentNewer, documentOversize,
        missingCore, invalidCore,
    }
}

/** A stored layout this version must never write over: saved under a later version, or too long to read. */
export function layoutLocked(chain: ProfileChainRead): boolean {
    return chain.documentNewer || chain.documentOversize
}

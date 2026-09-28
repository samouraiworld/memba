import type { UserProfile } from "../../lib/profile"
import { resolveAvatarUrl } from "../../lib/ipfs"
import { defaultProfileDocument, safeProfileUrl, type ProfileChainRead, type ProfileDocument } from "./profileData"

export type FieldSource = "Gno profile" | "Gno username" | "Address" | "Memba legacy" | "Gnolove" | "None"
export interface ShownField { value: string; source: FieldSource }
export interface ShownProfile {
    address: string
    username: string
    displayName: string
    displayNameSource: FieldSource
    avatar: string
    bio: ShownField
    location: ShownField
    homepage: ShownField
    title: ShownField
    company: ShownField
    document: ProfileDocument
    documentPresent: boolean
    legacyLinks: { label: string; url: string; source: FieldSource }[]
    governanceVotes: UserProfile["governanceVotes"]
    deployedPackages: UserProfile["deployedPackages"]
    chainProblem: boolean
    documentProblem: boolean
}

function shown(chain: string | null | undefined, legacy: string, legacySource: FieldSource): ShownField {
    if (chain !== null && chain !== undefined) return { value: chain, source: "Gno profile" }
    return legacy ? { value: legacy, source: legacySource } : { value: "", source: "None" }
}

function imageUrl(value: string): string {
    const resolved = resolveAvatarUrl(value)
    return safeProfileUrl(resolved) ?? ""
}

export function shownProfile(address: string, chain: ProfileChainRead | null, legacy: UserProfile | null): ShownProfile {
    const username = legacy?.username ?? ""
    const displayName = chain?.core.displayName || username || `${address.slice(0, 10)}…${address.slice(-4)}`
    const displayNameSource: FieldSource = chain?.core.displayName ? "Gno profile" : username ? "Gno username" : "Address"
    const avatarRaw = chain?.core.avatar !== null && chain?.core.avatar !== undefined
        ? chain.core.avatar
        : legacy?.avatarUrl || legacy?.githubAvatar || ""
    const legacyLinks: ShownProfile["legacyLinks"] = []
    const twitter = legacy?.socialLinks.twitter ?? ""
    if (twitter) {
        const url = safeProfileUrl(twitter.startsWith("https://") ? twitter : `https://x.com/${twitter.replace(/^@/, "")}`)
        if (url) legacyLinks.push({ label: "X", url, source: "Memba legacy" })
    }
    const github = legacy?.socialLinks.github ?? ""
    if (github) {
        const url = safeProfileUrl(github.startsWith("https://") ? github : `https://github.com/${github.replace(/^@/, "")}`)
        if (url) legacyLinks.push({ label: "GitHub", url, source: legacy?.githubLogin ? "Gnolove" : "Memba legacy" })
    }
    const document = chain?.document
    return {
        address, username, displayName, displayNameSource, avatar: imageUrl(avatarRaw),
        bio: shown(chain?.core.bio, legacy?.bio || legacy?.githubBio || "", legacy?.bio ? "Memba legacy" : "Gnolove"),
        location: shown(chain?.core.location, legacy?.githubLocation || "", "Gnolove"),
        homepage: shown(chain?.core.homepage, legacy?.socialLinks.website || "", "Memba legacy"),
        title: shown(chain?.documentPresent ? document?.title : null, legacy?.title || "", "Memba legacy"),
        company: shown(chain?.documentPresent ? document?.company : null, legacy?.company || "", "Memba legacy"),
        document: document ?? defaultProfileDocument(), documentPresent: chain?.documentPresent ?? false,
        legacyLinks, governanceVotes: legacy?.governanceVotes ?? [], deployedPackages: legacy?.deployedPackages ?? [],
        chainProblem: chain === null || chain.missingCore.length > 0,
        documentProblem: chain?.documentProblem ?? false,
    }
}

/**
 * User profile data layer — hybrid architecture:
 * - On-chain: @username from gno.land user registry
 * - Gnolove: GitHub profile, contribution stats, deployed packages
 * - Memba backend: editable fields (bio, company, title, socials) — Phase 2
 *
 * See: gno.land/r/gnoland/users/v1, Gnolove API
 */

import { getExplorerBaseUrl, getUserRegistryPath } from "./config"
import { resilientFetch } from "./rpcFallback"
import { api } from "./api"
import type { Token } from "../gen/memba/v1/memba_pb"

// ── Types ─────────────────────────────────────────────────────

export interface GnoPackage {
    address: string
    path: string
    namespace: string
    blockHeight: number
}

export interface GovVote {
    proposalId: string
    proposalTitle: string
    vote: string
}

export interface SocialLinks {
    twitter: string
    github: string
    website: string
}

export interface UserProfile {
    address: string
    // On-chain identity (from gno.land registry)
    username: string              // @username or empty
    userRealmUrl: string          // link to gno.land/u/{username}
    // Gnolove GitHub data (read-only)
    githubLogin: string
    githubAvatar: string
    githubBio: string
    githubLocation: string
    githubFollowers: number
    socialLinks: SocialLinks
    // Gnolove contribution stats (read-only)
    totalCommits: number
    totalPRs: number
    totalIssues: number
    totalReviews: number
    lovePowerScore: number
    // Gnolove on-chain data
    deployedPackages: GnoPackage[]
    governanceVotes: GovVote[]
    // Editable fields (Memba backend — Phase 2)
    bio: string
    company: string
    title: string
    avatarUrl: string
}

// ── Fetchers ──────────────────────────────────────────────────

const USER_REGISTRY = getUserRegistryPath()

/** Fetch a complete user profile from all data sources in parallel. */
export async function fetchUserProfile(
    gnoloveApiUrl: string,
    address: string,
): Promise<UserProfile> {
    const profile: UserProfile = {
        address,
        username: "",
        userRealmUrl: "",
        githubLogin: "",
        githubAvatar: "",
        githubBio: "",
        githubLocation: "",
        githubFollowers: 0,
        socialLinks: { twitter: "", github: "", website: "" },
        totalCommits: 0,
        totalPRs: 0,
        totalIssues: 0,
        totalReviews: 0,
        lovePowerScore: 0,
        deployedPackages: [],
        governanceVotes: [],
        bio: "",
        company: "",
        title: "",
        avatarUrl: "",
    }

    // Parallel fetch from all sources — graceful degradation on failure
    const [usernameResult, gnoloveResult, packagesResult, votesResult, backendResult] = await Promise.allSettled([
        resolveOnChainUsername(address),
        fetchGnoloveUser(gnoloveApiUrl, address),
        fetchGnolovePackages(gnoloveApiUrl, address),
        fetchGnoloveVotes(gnoloveApiUrl, address),
        fetchBackendProfile(address),
    ])

    // On-chain username
    if (usernameResult.status === "fulfilled" && usernameResult.value) {
        profile.username = usernameResult.value
        const clean = usernameResult.value.replace("@", "")
        profile.userRealmUrl = `${getExplorerBaseUrl()}/u/${clean}`
    }

    // Gnolove GitHub data
    if (gnoloveResult.status === "fulfilled" && gnoloveResult.value) {
        const g = gnoloveResult.value
        profile.githubLogin = g.login || ""
        profile.githubAvatar = g.avatarURL || ""
        profile.githubBio = g.bio || ""
        profile.githubLocation = g.location || ""
        profile.githubFollowers = g.followers || 0
        profile.socialLinks = {
            twitter: g.twitterUsername || "",
            github: g.login ? `https://github.com/${g.login}` : "",
            website: g.websiteUrl || "",
        }
    }

    // Gnolove contribution stats — compute from the leaderboard data
    if (gnoloveResult.status === "fulfilled" && gnoloveResult.value) {
        const g = gnoloveResult.value
        // Stats from the user's activity (issues, PRs, reviews, commits counts)
        profile.totalCommits = Array.isArray(g.commits) ? g.commits.length : 0
        profile.totalPRs = Array.isArray(g.pullRequests) ? g.pullRequests.length : 0
        profile.totalIssues = Array.isArray(g.issues) ? g.issues.length : 0
        profile.totalReviews = Array.isArray(g.reviews) ? g.reviews.length : 0
        // Love power score: commits×10 + PRs×2 + issues×0.5 + reviews×2
        profile.lovePowerScore = Math.round(
            profile.totalCommits * 10 +
            profile.totalPRs * 2 +
            profile.totalIssues * 0.5 +
            profile.totalReviews * 2,
        )
    }

    // Deployed packages
    if (packagesResult.status === "fulfilled") {
        profile.deployedPackages = packagesResult.value
    }

    // Governance votes
    if (votesResult.status === "fulfilled") {
        profile.governanceVotes = votesResult.value
    }

    // Backend editable profile — override gnolove defaults when present
    if (backendResult.status === "fulfilled" && backendResult.value) {
        const b = backendResult.value
        if (b.bio) profile.bio = b.bio
        if (b.company) profile.company = b.company
        if (b.title) profile.title = b.title
        if (b.avatarUrl) profile.avatarUrl = b.avatarUrl
        // Backend socials override gnolove socials when set
        if (b.twitter) profile.socialLinks.twitter = b.twitter
        if (b.github) profile.socialLinks.github = b.github
        if (b.website) profile.socialLinks.website = b.website
    }

    return profile
}

// ── Internal Helpers ──────────────────────────────────────────

/** Resolve @username from gno.land user registry via ABCI. */
export async function resolveOnChainUsername(address: string): Promise<string> {
    try {
        const b64Data = btoa(`${USER_REGISTRY}:${address}`)
        const res = await resilientFetch((rpcUrl) => ({
            url: rpcUrl,
            init: {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "profile",
                    method: "abci_query",
                    params: { path: "vm/qrender", data: b64Data },
                }),
            },
        }))
        const json = await res.json()
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return ""
        const binaryStr = atob(value)
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0))
        const data = new TextDecoder().decode(bytes)
        // Primary format (r/gnoland/users/v1): "# User - `username`"
        // Secondary format (r/sys/users): may differ — try fallback patterns
        const m = data.match(/# User - `([^`]+)`/)
            || data.match(/\*\s+\[([^\]]+)\]\(/)           // " * [username](link)" list format
            || data.match(/username:\s*([a-zA-Z0-9_]+)/)   // structured fallback
        return m ? `@${m[1]}` : ""
    } catch {
        return ""
    }
}

/** Fetch user from gnolove API by wallet address. */
async function fetchGnoloveUser(
    apiUrl: string,
    address: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
    try {
        const res = await fetch(`${apiUrl}/users/${address}`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

/** Fetch deployed packages from gnolove API. */
async function fetchGnolovePackages(
    apiUrl: string,
    address: string,
): Promise<GnoPackage[]> {
    try {
        const res = await fetch(`${apiUrl}/onchain/packages/${address}`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
}

/** Fetch governance votes from gnolove API. */
async function fetchGnoloveVotes(
    apiUrl: string,
    address: string,
): Promise<GovVote[]> {
    try {
        const res = await fetch(`${apiUrl}/onchain/votes/${address}`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
}

// ── Backend Profile (Memba ConnectRPC) ────────────────────────

interface BackendProfile {
    bio: string
    company: string
    title: string
    avatarUrl: string
    twitter: string
    github: string
    website: string
}

/** Fetch editable profile fields from Memba backend. */
export async function fetchBackendProfile(address: string): Promise<BackendProfile | null> {
    try {
        const res = await api.getProfile({ address })
        const p = res.profile
        if (!p) return null
        return {
            bio: p.bio,
            company: p.company,
            title: p.title,
            avatarUrl: p.avatarUrl,
            twitter: p.twitter,
            github: p.github,
            website: p.website,
        }
    } catch {
        return null
    }
}

/** Save editable profile fields via Memba backend. Returns updated profile. */
export async function updateBackendProfile(
    token: Token,
    fields: {
        bio?: string
        company?: string
        title?: string
        avatarUrl?: string
        twitter?: string
        github?: string
        website?: string
    },
): Promise<void> {
    await api.updateProfile({
        authToken: token,
        profile: {
            address: token.userAddress,
            bio: fields.bio ?? "",
            company: fields.company ?? "",
            title: fields.title ?? "",
            avatarUrl: fields.avatarUrl ?? "",
            twitter: fields.twitter ?? "",
            github: fields.github ?? "",
            website: fields.website ?? "",
        },
    })
}

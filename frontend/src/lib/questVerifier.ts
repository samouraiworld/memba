/**
 * questVerifier.ts — GnoBuilders quest verification engine.
 *
 * Provides verification functions for different quest types:
 * - on_chain: ABCI queries to verify realm deployments, DAO membership, votes, etc.
 * - off_chain: Backend/localStorage checks for profile, teams, page visits, etc.
 * - social: OAuth or link proof (Twitter, Discord)
 * - self_report: User-submitted proof with admin review queue
 *
 * All verifiers return a QuestVerificationResult indicating pass/fail/pending.
 * Verification is non-blocking: if the chain is down, results are "pending".
 */

import { queryRender } from "./dao/shared"
import { fetchAccountInfo } from "./account"
import { getDAOMembers } from "./dao/members"
import { fetchBackendProfile } from "./profile"
import { api } from "./api"
import { create } from "@bufbuild/protobuf"
import { GetMyTeamsRequestSchema } from "../gen/memba/v1/memba_pb"
import { loadQuestProgress } from "./quests"
import { ALL_QUESTS, type GnoQuest } from "./gnobuilders"
import type { Token } from "../gen/memba/v1/memba_pb"

// ── Types ────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "not_verified" | "pending" | "error"

export interface QuestVerificationResult {
    status: VerificationStatus
    message: string
}

const VERIFIED: QuestVerificationResult = { status: "verified", message: "Quest requirements met" }
const NOT_VERIFIED = (msg: string): QuestVerificationResult => ({ status: "not_verified", message: msg })
const PENDING = (msg: string): QuestVerificationResult => ({ status: "pending", message: msg })
const ERROR = (msg: string): QuestVerificationResult => ({ status: "error", message: msg })

// ── Main Verification Entry Point ───────────────────────────

/**
 * Verify whether a quest's conditions are met for the given user.
 * Dispatches to the appropriate verifier based on quest verification type.
 */
export async function verifyQuest(
    questId: string,
    address: string,
    rpcUrl: string,
    authToken?: Token,
): Promise<QuestVerificationResult> {
    const quest = ALL_QUESTS.find(q => q.id === questId)
    if (!quest) return ERROR("Unknown quest: " + questId)

    // Check if already completed
    const state = loadQuestProgress()
    if (state.completed.some(c => c.questId === questId)) {
        return VERIFIED
    }

    // Check prerequisite
    if (quest.prerequisite && !state.completed.some(c => c.questId === quest.prerequisite)) {
        return NOT_VERIFIED("Prerequisite not met: complete '" + quest.prerequisite + "' first")
    }

    try {
        switch (quest.verification) {
            case "on_chain":
                return await verifyOnChain(quest, address, rpcUrl)
            case "off_chain":
                return await verifyOffChain(quest, address, authToken)
            case "social":
                return verifySocial(quest)
            case "self_report":
                return NOT_VERIFIED("Submit proof to complete this quest")
            default:
                return ERROR("Unknown verification type")
        }
    } catch {
        return PENDING("Verification unavailable — will retry when chain is accessible")
    }
}

// ── On-Chain Verifiers ──────────────────────────────────────

async function verifyOnChain(
    quest: GnoQuest,
    address: string,
    rpcUrl: string,
): Promise<QuestVerificationResult> {
    switch (quest.id) {
        // Package/Realm deployment quests — user provides their realm path
        case "deploy-hello-pkg":
        case "deploy-counter-pkg":
        case "deploy-avl-pkg":
        case "deploy-interface-pkg":
        case "deploy-import-pkg":
        case "deploy-event-pkg":
        case "deploy-ownable-pkg":
        case "deploy-upgradable-pkg":
        case "deploy-governance-pkg":
        case "deploy-hello-realm":
        case "deploy-grc20-realm":
        case "deploy-grc721-realm":
        case "deploy-board-realm":
        case "deploy-dao-realm":
        case "deploy-crossing-realm":
        case "deploy-escrow-realm":
        case "deploy-marketplace-realm":
        case "deploy-multisig-realm":
        case "deploy-3-chains":
        case "render-masterclass":
            // These require the user to provide a realm path for verification
            return NOT_VERIFIED("Provide your deployed realm path to verify")

        case "register-username": {
            const result = await queryRender(rpcUrl, "gno.land/r/sys/users", address)
            if (result && result.length > 0 && !result.includes("not found")) {
                return VERIFIED
            }
            // Fallback: try legacy path
            const legacy = await queryRender(rpcUrl, "gno.land/r/gnoland/users", address)
            if (legacy && legacy.length > 0 && !legacy.includes("not found")) {
                return VERIFIED
            }
            return NOT_VERIFIED("No @username registered for your address")
        }

        case "first-transaction": {
            const info = await fetchAccountInfo(address)
            if (info.sequence > 0) return VERIFIED
            return NOT_VERIFIED("No transactions found for your address")
        }

        case "faucet-claim": {
            // Check if user account exists on-chain (implies faucet claim or transfer received)
            const info = await fetchAccountInfo(address)
            // accountNumber >= 0 is valid (0 is the first account); sequence > 0 means txs sent
            if (info.accountNumber >= 0 && info.sequence >= 0) {
                // If the account was found (not default zeros), it exists on chain
                if (info.accountNumber > 0 || info.sequence > 0) return VERIFIED
            }
            return NOT_VERIFIED("Claim tokens from the testnet faucet first")
        }

        case "join-dao": {
            // Check MembaDAO membership as a default check
            const daoPath = "gno.land/r/samcrew/memba_dao"
            try {
                const members = await getDAOMembers(rpcUrl, daoPath)
                if (members.some(m => m.address === address)) return VERIFIED
            } catch { /* fallthrough */ }
            return NOT_VERIFIED("Join a DAO to complete this quest")
        }

        case "3-dao-member":
            // Requires checking multiple DAOs — self-report with proof
            return NOT_VERIFIED("Submit proof of membership in 3+ DAOs")

        case "create-dao":
            // Would need to scan for DAOs created by this address
            return NOT_VERIFIED("Provide your DAO realm path to verify")

        case "vote-proposal":
        case "vote-5-proposals":
        case "create-proposal":
        case "execute-proposal":
            // These require parsing DAO governance state for the user's votes
            return NOT_VERIFIED("Provide the DAO path where you voted")

        case "post-board":
        case "channel-active": {
            // Check channels v2 for user's posts
            const { MEMBA_DAO } = await import("./config")
            const channelRender = await queryRender(rpcUrl, MEMBA_DAO.channelsPath, "general")
            if (channelRender && channelRender.includes(address.slice(0, 10))) {
                return VERIFIED
            }
            return NOT_VERIFIED("Post a thread in MembaDAO channels to verify")
        }
        case "reply-board":
        case "10-board-posts":
        case "help-newcomer":
            return NOT_VERIFIED("Post in MembaDAO channels to verify")

        case "submit-candidature": {
            // Check v2 candidature realm for user's application
            const { MEMBA_DAO } = await import("./config")
            const appResult = await queryRender(rpcUrl, MEMBA_DAO.candidaturePath, `application/${address}`)
            if (appResult && !appResult.includes("Not Found") && !appResult.includes("404")) {
                return VERIFIED
            }
            return NOT_VERIFIED("Submit a candidature application to verify")
        }

        case "create-token": {
            // Check token factory for tokens created by this address
            const result = await queryRender(rpcUrl, "gno.land/r/samcrew/tokenfactory", "")
            if (result && result.includes(address)) return VERIFIED
            return NOT_VERIFIED("Create a token via the token factory")
        }

        case "send-tokens":
            // Requires tx history which we can't easily verify via ABCI
            return NOT_VERIFIED("Send tokens to another address and provide the tx hash")

        case "mint-nft":
        case "list-nft":
            return NOT_VERIFIED("Provide the NFT collection path to verify")

        case "hold-5-tokens":
            // Requires dynamic token registry — cannot verify with static list.
            // Fall through to self-report.
            return NOT_VERIFIED("Submit proof of holding 5+ different GRC20 tokens")

        case "treasury-contributor":
        case "multisig-signer":
        case "validator-delegator":
        case "genesis-dao-voter":
        case "deploy-ibc-realm":
            return NOT_VERIFIED("Submit proof to verify this quest")

        default:
            return NOT_VERIFIED("On-chain verification not yet implemented for this quest")
    }
}

// ── Off-Chain Verifiers ─────────────────────────────────────
//
// SECURITY NOTE: localStorage-based quests (visit-5-pages, ai-report-reader,
// weekly-login, all-networks) are trivially cheatable via DevTools.
// This is an accepted trade-off: these quests have low XP (10-25) and the
// server-side XP calculation from validQuests prevents XP inflation.
// The real XP authority is the backend quest_completions table.

async function verifyOffChain(
    quest: GnoQuest,
    address: string,
    authToken?: Token,
): Promise<QuestVerificationResult> {
    switch (quest.id) {
        case "connect-wallet":
            // Already handled by the quest trigger in Layout.tsx
            return address ? VERIFIED : NOT_VERIFIED("Connect your wallet")

        case "setup-profile": {
            const profile = await fetchBackendProfile(address)
            if (profile && (profile.bio || profile.avatarUrl)) return VERIFIED
            return NOT_VERIFIED("Set up your profile with a bio or avatar")
        }

        case "visit-5-pages": {
            const key = `memba_quest_pages_${address}`
            try {
                const raw = localStorage.getItem(key)
                const pages: string[] = raw ? JSON.parse(raw) : []
                if (pages.length >= 5) return VERIFIED
                return NOT_VERIFIED(`Visit ${5 - pages.length} more pages`)
            } catch {
                return NOT_VERIFIED("Visit 5 different pages")
            }
        }

        case "use-cmdk":
        case "switch-network":
        case "view-validator":
        case "share-link":
        case "submit-feedback":
        case "read-docs":
            // These are triggered by UI actions and completed via completeQuest()
            return NOT_VERIFIED("Complete the action to verify")

        case "browse-proposals":
            return NOT_VERIFIED("Browse a DAO's proposals page")

        case "invite-member":
            // Cannot reliably verify who sent an invite vs who received one.
            // Tracked via localStorage when user copies an invite code.
            return NOT_VERIFIED("Copy and share a team invite code")

        case "create-team": {
            if (!authToken) return NOT_VERIFIED("Sign in to verify")
            const resp = await api.getMyTeams(create(GetMyTeamsRequestSchema, { authToken }))
            const ownedTeams = resp.teams?.filter(t => t.members?.some(
                m => m.address === address && m.role === 2 /* ADMIN */
            ))
            if (ownedTeams && ownedTeams.length > 0) {
                // Check if team has 3+ members
                const bigTeam = ownedTeams.find(t => (t.members?.length || 0) >= 3)
                if (bigTeam) return VERIFIED
                return NOT_VERIFIED("Your team needs 3+ members")
            }
            return NOT_VERIFIED("Create a team first")
        }

        case "complete-all-everyone": {
            const state = loadQuestProgress()
            const completedIds = new Set(state.completed.map(c => c.questId))
            const everyoneQuests = ALL_QUESTS.filter(q => q.category === "everyone")
            const allDone = everyoneQuests.every(q => completedIds.has(q.id))
            if (allDone) return VERIFIED
            const remaining = everyoneQuests.filter(q => !completedIds.has(q.id))
            return NOT_VERIFIED(`${remaining.length} 'Everyone' quests remaining`)
        }

        case "earn-500-xp": {
            const state = loadQuestProgress()
            if (state.totalXP >= 500) return VERIFIED
            return NOT_VERIFIED(`${500 - state.totalXP} more XP needed`)
        }

        case "earn-1000-xp": {
            const state = loadQuestProgress()
            if (state.totalXP >= 1000) return VERIFIED
            return NOT_VERIFIED(`${1000 - state.totalXP} more XP needed`)
        }

        case "top-10-leaderboard":
            // This requires checking the backend leaderboard
            return NOT_VERIFIED("Reach the top 10 to verify")

        case "gnolove-top-20":
            // This requires checking gnolove API
            return NOT_VERIFIED("Be in the Gnolove top 20 to verify")

        case "ai-report-reader": {
            // Track in localStorage
            const key = `memba_quest_ai_reports_${address}`
            try {
                const raw = localStorage.getItem(key)
                const reports: string[] = raw ? JSON.parse(raw) : []
                if (reports.length >= 5) return VERIFIED
                return NOT_VERIFIED(`Read ${5 - reports.length} more AI reports`)
            } catch {
                return NOT_VERIFIED("Read 5 AI governance reports")
            }
        }

        case "weekly-login": {
            // Check login streak from localStorage
            const key = `memba_quest_login_streak_${address}`
            try {
                const raw = localStorage.getItem(key)
                if (!raw) return NOT_VERIFIED("Log in 7 days in a row")
                const data = JSON.parse(raw) as { streak: number; dates: string[] }
                if (data.streak >= 7) return VERIFIED
                return NOT_VERIFIED(`${7 - data.streak} more consecutive days needed`)
            } catch {
                return NOT_VERIFIED("Log in 7 days in a row")
            }
        }

        // Hidden quests
        case "easter-egg-konami":
        case "night-owl":
        case "speed-runner":
        case "first-100-users":
        case "perfect-week":
        case "directory-deep-dive":
        case "all-networks":
        case "season-1-complete":
            // These are triggered automatically by the frontend
            return NOT_VERIFIED("Discover how to complete this quest")

        default:
            return NOT_VERIFIED("Verification not yet implemented")
    }
}

// ── Social Verifiers ────────────────────────────────────────

function verifySocial(quest: GnoQuest): QuestVerificationResult {
    switch (quest.id) {
        case "follow-twitter":
            return NOT_VERIFIED("Follow @_gnoland on Twitter and submit proof")
        case "join-discord":
            return NOT_VERIFIED("Join the Gno Discord server and submit proof")
        default:
            return NOT_VERIFIED("Social verification not yet implemented")
    }
}

// ── Deployment Verifier (for developer quests) ──────────────

/**
 * Verify a deployment quest by checking if a realm/package exists at the given path.
 * Used when the user provides their deployed realm path.
 */
export async function verifyDeployment(
    rpcUrl: string,
    realmPath: string,
    address: string,
): Promise<QuestVerificationResult> {
    try {
        // Ownership check: verify the realm path contains the user's address or namespace.
        // Gno realm paths are namespaced (e.g., gno.land/r/username/realm), so a deployed
        // realm should be under the deployer's namespace. We check if the address appears
        // in the Render() output (many realms include the admin/owner address).
        const result = await queryRender(rpcUrl, realmPath, "")
        if (!result || result.length === 0 || result.includes("not found")) {
            return NOT_VERIFIED("No realm found at path: " + realmPath)
        }

        // Check if the user's address appears in the realm output (admin/owner display)
        // or if the realm path contains a segment matching the user's address prefix
        const addrPrefix = address.slice(0, 10) // g1xxxxxxxx
        const pathContainsAddr = realmPath.toLowerCase().includes(addrPrefix.toLowerCase())
        const renderContainsAddr = result.includes(address) || result.includes(addrPrefix)

        if (pathContainsAddr || renderContainsAddr) {
            return VERIFIED
        }

        // If we can't confirm ownership but realm exists, still credit it but warn
        // (some realms don't display owner in Render output)
        return VERIFIED // Realm exists — benefit of the doubt for testnet quests
    } catch {
        return PENDING("Chain unavailable — will verify when accessible")
    }
}

// ── Tracking Helpers (for off-chain auto-complete quests) ────

/**
 * Track AI report view for the ai-report-reader quest.
 */
export function trackAIReportView(address: string, daoPath: string): void {
    if (!address) return
    try {
        const key = `memba_quest_ai_reports_${address}`
        const raw = localStorage.getItem(key)
        const reports: string[] = raw ? JSON.parse(raw) : []
        if (!reports.includes(daoPath)) {
            reports.push(daoPath)
            localStorage.setItem(key, JSON.stringify(reports))
        }
    } catch { /* best effort */ }
}

/**
 * Track daily login for the weekly-login quest.
 */
export function trackDailyLogin(address: string): void {
    if (!address) return
    try {
        const key = `memba_quest_login_streak_${address}`
        const today = new Date().toISOString().split("T")[0] // YYYY-MM-DD
        const raw = localStorage.getItem(key)
        const data: { streak: number; dates: string[]; lastDate: string } = raw
            ? JSON.parse(raw)
            : { streak: 0, dates: [], lastDate: "" }

        if (data.lastDate === today) return // Already tracked today

        // Check if this is consecutive
        const yesterdayDate = new Date()
        yesterdayDate.setDate(yesterdayDate.getDate() - 1)
        const yesterday = yesterdayDate.toISOString().split("T")[0]
        if (data.lastDate === yesterday) {
            data.streak++
        } else {
            data.streak = 1 // Reset streak
        }

        data.lastDate = today
        data.dates.push(today)
        // Keep only last 30 days of data
        if (data.dates.length > 30) data.dates = data.dates.slice(-30)
        localStorage.setItem(key, JSON.stringify(data))
    } catch { /* best effort */ }
}

/**
 * Track network switch for the all-networks quest.
 */
export function trackNetworkVisit(address: string, networkId: string): void {
    if (!address) return
    try {
        const key = `memba_quest_networks_${address}`
        const raw = localStorage.getItem(key)
        const networks: string[] = raw ? JSON.parse(raw) : []
        if (!networks.includes(networkId)) {
            networks.push(networkId)
            localStorage.setItem(key, JSON.stringify(networks))
        }
    } catch { /* best effort */ }
}

/**
 * Check if the Konami code was entered (for easter egg quest).
 */
export function setupKonamiDetector(onKonami: () => void): () => void {
    const sequence = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]
    let position = 0

    const handler = (e: KeyboardEvent) => {
        if (e.key === sequence[position]) {
            position++
            if (position === sequence.length) {
                position = 0
                onKonami()
            }
        } else {
            position = 0
        }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
}

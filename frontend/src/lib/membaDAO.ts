/**
 * MembaDAO — Configuration, deployment orchestration, and status queries.
 *
 * v2.1a: Ties together the DAO, Channels, Candidature, and $MEMBA token.
 *
 * Responsibilities:
 * - MembaDAO configuration constants (members, roles, channels)
 * - Deployment status checker (which components are live)
 * - Membership query helper
 * - Deployment orchestrator (ordered realm creation)
 *
 * @module lib/membaDAO
 */

import { MEMBA_DAO, MEMBA_TOKEN } from "./config"
import type { AminoMsg } from "./grc20"

// ── Founder Address ───────────────────────────────────────────

/** zôÖma — founding member and initial admin. */
export const ZOOMA_ADDRESS = "g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh"

// ── DAO Configuration ─────────────────────────────────────────

export interface MembaDAOMember {
    address: string
    power: number
    roles: string[]
}

export interface MembaDAOConfig {
    name: string
    description: string
    realmPath: string
    channelsPath: string
    candidaturePath: string
    members: MembaDAOMember[]
    threshold: number  // % of votes needed to pass
    quorum: number     // % of members that must vote
    roles: string[]
    proposalCategories: string[]
    tokenSymbol: string
}

export const MEMBA_DAO_CONFIG: MembaDAOConfig = {
    name: "MembaDAO",
    description: "The governing DAO of the Memba platform — community-driven development, treasury management, and membership governance.",
    realmPath: MEMBA_DAO.realmPath,
    channelsPath: MEMBA_DAO.channelsPath,
    candidaturePath: MEMBA_DAO.candidaturePath,
    members: [
        { address: ZOOMA_ADDRESS, power: 1, roles: ["admin", "dev"] },
    ],
    threshold: 66,
    quorum: 50,
    roles: ["admin", "dev", "ops", "member"],
    proposalCategories: ["governance", "treasury", "membership", "operations"],
    tokenSymbol: MEMBA_TOKEN.symbol,
}

// ── Channel Configuration ─────────────────────────────────────

export interface MembaChannel {
    name: string
    type: "text" | "announcements" | "readonly"
    description: string
}

/** Default MembaDAO channels. */
export const MEMBA_DAO_CHANNELS: MembaChannel[] = [
    { name: "general", type: "text", description: "General discussion for all members" },
    { name: "announcements", type: "announcements", description: "Official MembaDAO announcements — admin-write-only" },
    { name: "feature-requests", type: "text", description: "Propose and discuss new features" },
    { name: "support", type: "text", description: "Help and troubleshooting" },
    { name: "extensions", type: "text", description: "Plugin and extension development" },
    { name: "partnerships", type: "text", description: "Collaboration and partnership proposals" },
]

// ── Deployment Status ─────────────────────────────────────────

export interface MembaDeploymentStatus {
    dao: boolean
    channels: boolean
    candidature: boolean
    token: boolean
}

/**
 * Check which MembaDAO components are deployed on-chain.
 * Queries Render("") on each realm path.
 */
export async function getMembaDAOStatus(rpcUrl: string): Promise<MembaDeploymentStatus> {
    const check = async (path: string): Promise<boolean> => {
        try {
            const b64 = btoa(`${path}:`)
            const res = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "memba-status",
                    method: "abci_query",
                    params: { path: "vm/qrender", data: b64 },
                }),
            })
            const json = await res.json()
            return !!json?.result?.response?.ResponseBase?.Data
        } catch {
            return false
        }
    }

    const [dao, channels, candidature] = await Promise.all([
        check(MEMBA_DAO.realmPath),
        check(MEMBA_DAO.channelsPath),
        check(MEMBA_DAO.candidaturePath),
    ])

    // Token check via grc20factory
    let token = false
    try {
        const expr = `BalanceOf("${MEMBA_TOKEN.symbol}", "${ZOOMA_ADDRESS}")`
        const b64 = btoa(`${MEMBA_TOKEN.factoryPath}.${expr}`)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba-token",
                method: "abci_query",
                params: { path: "vm/qeval", data: b64 },
            }),
        })
        const json = await res.json()
        token = !!json?.result?.response?.ResponseBase?.Data
    } catch { /* not deployed */ }

    return { dao, channels, candidature, token }
}

/**
 * Check if an address is a MembaDAO member.
 * Queries Render("members") on the DAO realm.
 */
export async function isMembaDAOMember(rpcUrl: string, address: string): Promise<boolean> {
    try {
        const b64 = btoa(`${MEMBA_DAO.realmPath}:members`)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba-member",
                method: "abci_query",
                params: { path: "vm/qrender", data: b64 },
            }),
        })
        const json = await res.json()
        const data = json?.result?.response?.ResponseBase?.Data
        if (!data) return false
        const rendered = atob(data)
        // Split by lines and check each for address as a distinct token
        // (avoids false positives from substring matches)
        return rendered.split("\n").some(line => {
            const trimmed = line.trim()
            return trimmed === address || trimmed.startsWith(address + " ") || trimmed.includes(" " + address)
        })
    } catch {
        return false
    }
}

/**
 * Check if the current DAO (by realm path) is MembaDAO.
 */
export function isMembaDAO(realmPath: string): boolean {
    return realmPath === MEMBA_DAO.realmPath
}

// ── MsgCall Builders ──────────────────────────────────────────

/**
 * Build the deployment sequence for MembaDAO.
 * This is an ordered list of realm deployments needed.
 *
 * Note: Actual realm deployment uses MsgAddPackage, not MsgCall.
 * These builders prepare the configuration for the deployment wizard.
 */
export interface DeploymentStep {
    label: string
    realmPath: string
    description: string
    status: "pending" | "deployed" | "error"
}

export function getDeploymentSteps(status: MembaDeploymentStatus): DeploymentStep[] {
    return [
        {
            label: "MembaDAO Realm",
            realmPath: MEMBA_DAO.realmPath,
            description: "Core DAO governance realm with multisig",
            status: status.dao ? "deployed" : "pending",
        },
        {
            label: "Channels Realm",
            realmPath: MEMBA_DAO.channelsPath,
            description: "Discord-like discussion channels",
            status: status.channels ? "deployed" : "pending",
        },
        {
            label: "Candidature Realm",
            realmPath: MEMBA_DAO.candidaturePath,
            description: "Membership application flow",
            status: status.candidature ? "deployed" : "pending",
        },
        {
            label: `$${MEMBA_TOKEN.symbol} Token`,
            realmPath: MEMBA_TOKEN.factoryPath,
            description: `GRC20 governance token via factory`,
            status: status.token ? "deployed" : "pending",
        },
    ]
}

/**
 * Build MsgCall to add a new member to MembaDAO (after candidature approval).
 * This is a cross-realm call from the candidature realm.
 */
export function buildAddMemberMsg(
    callerAddress: string,
    newMemberAddress: string,
    power: number = 1,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: MEMBA_DAO.realmPath,
            func: "AddMember",
            args: [newMemberAddress, String(power)],
        },
    }
}

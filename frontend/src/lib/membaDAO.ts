/**
 * MembaDAO — Configuration and deployment orchestration.
 *
 * v2.1a: Ties together the DAO, Channels, Candidature, and $MEMBA token.
 *
 * Responsibilities:
 * - MembaDAO configuration constants (members, roles, channels)
 * - Deployment orchestrator (ordered realm creation)
 *
 * @module lib/membaDAO
 */

import { MEMBA_DAO, MEMBA_TOKEN } from "./config"
import type { AminoMsg } from "./grc20"

// ── Founder Address ───────────────────────────────────────────

/** samcrew-core-test1 multisig — founding member and initial admin (testnet).
 *  Production: replace with samourai-crew 3-of-7 multisig. */
export const ZOOMA_ADDRESS = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

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

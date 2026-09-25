/**
 * questNetwork.ts — which quests can complete on a given network.
 *
 * Some on_chain quests are checked against a single Memba realm. Where that
 * realm isn't deployed (mainnet has no memba_dao, candidature or token factory
 * yet), the quest can never complete, so it is shown as "Not available on this
 * network yet" instead of offering a verify action that always fails.
 *
 * Mirrors the realms read by backend/internal/service/quest_verify*.go.
 */

import { GRC20_FACTORY_PATH, MEMBA_DAO, isRealmValidOn } from "./config"
import { isQuestAvailable } from "./gnobuilders"

/** The Memba realm each realm-bound quest's check reads. */
export const QUEST_REQUIRED_REALMS: Readonly<Record<string, string>> = {
    "join-dao": MEMBA_DAO.realmPath,
    "submit-candidature": MEMBA_DAO.candidaturePath,
    "create-token": GRC20_FACTORY_PATH,
}

/** Label shown on a quest whose realm isn't deployed on the active network. */
export const QUEST_NOT_ON_NETWORK_LABEL = "Not available on this network yet"

/** Prefix of the backend's realmNotDeployedError message (quest_verify.go). */
const SERVER_NOT_ON_NETWORK = "not available on this network yet"

/**
 * True unless the quest needs a realm that isn't valid on `networkKey`.
 * Quests that don't read a Memba realm are unaffected.
 */
export function isQuestAvailableOnNetwork(questId: string, networkKey: string): boolean {
    const realm = QUEST_REQUIRED_REALMS[questId]
    return !realm || isRealmValidOn(networkKey, realm)
}

/**
 * A quest's Quest Hub status. "available" needs both the prerequisites and the
 * quest's realm on this network; every other quest not yet completed is
 * "locked", so the Available and Locked filters always split the open quests
 * between them (a quest whose realm is missing is shown as locked).
 */
export function questHubStatus(
    questId: string,
    completedIds: Set<string>,
    networkKey: string,
): "completed" | "available" | "locked" {
    if (completedIds.has(questId)) return "completed"
    return isQuestAvailable(questId, completedIds) && isQuestAvailableOnNetwork(questId, networkKey)
        ? "available"
        : "locked"
}

/**
 * The server's "not available on this network yet" rejection, as a user-facing
 * message, or null for any other error. The backend verifies against its own
 * chain, which can lack a realm the active network has.
 */
export function notOnNetworkMessage(err: unknown): string | null {
    const raw = err instanceof Error ? err.message : ""
    const i = raw.indexOf(SERVER_NOT_ON_NETWORK)
    if (i < 0) return null
    const detail = raw.slice(i + SERVER_NOT_ON_NETWORK.length).replace(/^:\s*/, "").trim()
    return detail ? `${QUEST_NOT_ON_NETWORK_LABEL}: ${detail}.` : `${QUEST_NOT_ON_NETWORK_LABEL}.`
}

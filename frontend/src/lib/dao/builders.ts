/**
 * DAO message builders — one entry point, `buildDaoMsg(kind, realmPath, action, caller)`.
 *
 * The DAO kind (resolved by kind.ts) selects the contract ABI. A kind/action
 * pair that the target contract does not export is refused, so Memba never
 * asks a wallet to sign a call that is guaranteed to fail. The function names
 * and argument counts are pinned by builders.abi.test.ts against recorded
 * function lists in testdata/funcs/.
 *
 * - govdao   (gno.land/r/gov/dao): vote + execute only. Proposals need a struct
 *            argument, which a MsgCall cannot pass.
 * - memba-v1 (generated template, API 1.0): Propose / VoteOnProposal /
 *            ExecuteProposal and the Propose* membership calls. The unilateral
 *            AssignRole / RemoveRole / Archive calls are never built.
 * - memba-v2 (generated template "memba-dao/2"): one propose entry point per
 *            action kind, Vote, Execute.
 * - daokit, weighted, unknown: no writes from the generic DAO shell.
 */

import type { AminoMsg } from "./shared"
import { isGovDAOPath, type DaoKind } from "./kind"
import { isValidGnoAddressChecksum } from "./address"

export { isGovDAOPath } from "./kind"

/** GovDAO vote function (present on gnoland-1, see testdata/funcs/govdao-gnoland-1.json). */
export const GOVDAO_VOTE_FUNC = "MustVoteOnProposalSimple"

/** GovDAO execute function; rejects the proposal instead of leaving it stuck when execution errors. */
export const GOVDAO_EXECUTE_FUNC = "ExecuteOrRejectProposal"

export type VoteChoice = "YES" | "NO" | "ABSTAIN"

export type DaoAction =
    | { type: "vote"; id: number; vote: VoteChoice }
    | { type: "execute"; id: number }
    | { type: "propose-text"; title: string; description: string; category: string }
    | { type: "propose-add-member"; title: string; description: string; target: string; power: number; roles: string[] }
    | { type: "propose-remove-member"; title: string; description: string; target: string }
    | { type: "propose-change-role"; title: string; description: string; target: string; roles: string[] }
    | { type: "propose-archive"; title: string; description: string }

const REALM_PATH_RE = /^gno\.land\/r\/[a-z0-9_-]+(?:\/[a-z0-9_]+)*$/
const IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,29}$/
const VOTES: ReadonlySet<string> = new Set(["YES", "NO", "ABSTAIN"])

function unsupported(kind: DaoKind, action: DaoAction): never {
    throw new Error(`Action "${action.type}" is not supported for this DAO contract (${kind})`)
}

function id(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid proposal id")
    return String(value)
}

function vote(value: string): string {
    if (!VOTES.has(value)) throw new Error("Invalid vote option")
    return value
}

function target(value: string): string {
    if (!isValidGnoAddressChecksum(value)) throw new Error("Invalid member address")
    return value
}

function power(value: number, max = Number.MAX_SAFE_INTEGER): string {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error("Voting power must be a positive integer within the DAO's limit")
    return String(value)
}

/** Bounds of the version-2 realm (templates/dao/v2/realm.ts): power 1..1e9, role lists may be empty. */
const V2_MAX_POWER = 1_000_000_000

function roles(values: string[], min = 1): string {
    if (!Array.isArray(values) || values.length < min || values.some(r => !IDENTIFIER_RE.test(r))) throw new Error("Invalid roles")
    return values.join(",")
}

function category(value: string): string {
    if (!IDENTIFIER_RE.test(value)) throw new Error("Invalid category")
    return value
}

function call(caller: string, realmPath: string, func: string, args: string[]): AminoMsg {
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func, args } }
}

export function buildDaoMsg(kind: DaoKind, realmPath: string, action: DaoAction, caller: string): AminoMsg {
    if (!caller) throw new Error("Connect a wallet first")
    if (!REALM_PATH_RE.test(realmPath)) throw new Error("Invalid realm path")

    switch (kind) {
        case "govdao": {
            if (!isGovDAOPath(realmPath)) return unsupported(kind, action)
            if (action.type === "vote") return call(caller, realmPath, GOVDAO_VOTE_FUNC, [id(action.id), vote(action.vote)])
            if (action.type === "execute") return call(caller, realmPath, GOVDAO_EXECUTE_FUNC, [id(action.id)])
            return unsupported(kind, action)
        }
        case "memba-v1": {
            switch (action.type) {
                case "vote": return call(caller, realmPath, "VoteOnProposal", [id(action.id), vote(action.vote)])
                case "execute": return call(caller, realmPath, "ExecuteProposal", [id(action.id)])
                case "propose-text": return call(caller, realmPath, "Propose", [action.title, action.description, category(action.category)])
                case "propose-add-member": return call(caller, realmPath, "ProposeAddMember", [target(action.target), power(action.power), roles(action.roles)])
                case "propose-remove-member": return call(caller, realmPath, "ProposeRemoveMember", [target(action.target)])
                case "propose-change-role":
                    // v1 assigns exactly one role per proposal.
                    if (action.roles.length !== 1) throw new Error("Version-1 DAOs change one role per proposal")
                    return call(caller, realmPath, "ProposeAssignRole", [target(action.target), roles(action.roles)])
                default: return unsupported(kind, action)
            }
        }
        case "memba-v2": {
            switch (action.type) {
                case "vote": return call(caller, realmPath, "Vote", [id(action.id), vote(action.vote)])
                case "execute": return call(caller, realmPath, "Execute", [id(action.id)])
                case "propose-text": return call(caller, realmPath, "ProposeText", [action.title, action.description, category(action.category)])
                case "propose-add-member": return call(caller, realmPath, "ProposeAddMember", [action.title, action.description, target(action.target), power(action.power, V2_MAX_POWER), roles(action.roles, 0)])
                case "propose-remove-member": return call(caller, realmPath, "ProposeRemoveMember", [action.title, action.description, target(action.target)])
                case "propose-change-role": return call(caller, realmPath, "ProposeSetRoles", [action.title, action.description, target(action.target), roles(action.roles, 0)])
                case "propose-archive": return call(caller, realmPath, "ProposeArchive", [action.title, action.description])
                default: return unsupported(kind, action)
            }
        }
        default:
            return unsupported(kind, action)
    }
}

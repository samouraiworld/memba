/**
 * Authority handoff of the ten application targets to the weighted host v12.
 *
 * A target changes hands in two steps: its publisher nominates the DAO as
 * pending owner (admin for market-config and escrow, moderator for reviews),
 * then the DAO votes `Propose<Adapter>Accept`. The realm refuses the proposal
 * unless the DAO is the pending authority, so Memba offers it only then.
 *
 * The getters below are the ones the generated DAO's `<adapter>State` readers
 * call (the host freezes their values into the proposal), with the return
 * types of each target's source (`testdata/weighted-v12/target-getters.txt`).
 * The extra checks mirror the host's accept preconditions that do not concern
 * the pending authority itself; the realm stays the final judge.
 */
import { z } from "zod"
import type { WeightedContext } from "./weighted"
import { assertWeightedChain, qevalText } from "./weighted"
import { APPLICATION_TARGETS, packageAddress, type ApplicationPolicyKey } from "./weightedApplications"
export { ACCEPT_ACTIONS, ACCEPT_FUNCS, acceptAdapterFor } from "./weightedApplications"
import { address } from "./weightedPrimitives"

type ValueType = "address" | "string"
/** Authority getters per adapter, exactly as the generated DAO reads them. */
export const AUTHORITY_GETTERS: Record<ApplicationPolicyKey, { authority: "admin" | "owner" | "moderator"; current: string; pending: string; type: ValueType }> = {
    marketPolicy: { authority: "admin", current: "GetAdmin", pending: "GetPendingAdmin", type: "address" },
    reviewsPolicy: { authority: "moderator", current: "GetModerator", pending: "GetPendingModerator", type: "string" },
    questPolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "string" },
    arcadePolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
    appstorePolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
    escrowPolicy: { authority: "admin", current: "GetAdmin", pending: "GetPendingAdmin", type: "string" },
    badgesPolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
    feedPolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
    channelsPolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
    feedbackPolicy: { authority: "owner", current: "GetOwner", pending: "GetPendingOwner", type: "address" },
}

/** One extra accept precondition: a getter whose value must equal `expect`. */
type Probe = { expression: (who: { owner: string; dao: string }) => string; expect: boolean | string; reason: string }
const probe = (fn: string, subject: "owner" | "dao", expect: boolean, reason: string): Probe => ({ expression: w => `${fn}("${w[subject]}")`, expect, reason })
export const ACCEPT_PROBES: Partial<Record<ApplicationPolicyKey, Probe[]>> = {
    badgesPolicy: [probe("IsAdmin", "owner", true, "The current owner is not a badges admin, so the host refuses the handoff.")],
    feedPolicy: [probe("IsModerator", "owner", false, "The current owner is still a feed moderator. The publisher must remove that grant before the DAO accepts.")],
    channelsPolicy: [
        probe("IsMember", "owner", true, "The current owner is not a channels member, so the host refuses the handoff."),
        probe("IsMember", "dao", false, "The DAO already has channels membership, so the host refuses the handoff."),
    ],
    feedbackPolicy: [
        probe("IsMember", "owner", true, "The current owner is not a feedback member, so the host refuses the handoff."),
        probe("IsMember", "dao", false, "The DAO already has feedback membership, so the host refuses the handoff."),
        { expression: w => `GetMemberRoles("${w.owner}")`, expect: "admin", reason: "The current owner's feedback roles are not exactly admin, so the host refuses the handoff." },
    ],
}

// ── Typed qeval results ──────────────────────────────────────────────────────

/** An address read from a getter: `""` when unset. Refuses any other shape or type. */
export function parseQevalAddress(raw: string, type: ValueType): string {
    const text = raw.trim()
    const empty = type === "address" ? /^\(\s*(?:""\s*)?\.uverse\.address\s*\)$/ : /^\(""\s+string\)$/
    if (empty.test(text)) return ""
    const m = text.match(type === "address" ? /^\("(g1[0-9a-z]{38})"\s+\.uverse\.address\)$/ : /^\("(g1[0-9a-z]{38})"\s+string\)$/)
    if (!m) throw new Error("Unexpected authority read")
    return address.parse(m[1])
}

export function parseQevalBool(raw: string): boolean {
    const m = raw.trim().match(/^\((true|false)\s+bool\)$/)
    if (!m) throw new Error("Unexpected boolean read")
    return m[1] === "true"
}

/** A plain Go string result; only printable ASCII without escapes is accepted. */
export function parseQevalString(raw: string): string {
    const m = raw.trim().match(/^\("([\x20-\x21\x23-\x5b\x5d-\x7e]{0,500})"\s+string\)$/)
    if (!m) throw new Error("Unexpected string read")
    return m[1]
}

// ── State machine ────────────────────────────────────────────────────────────

export type AuthorityRead = { current: string; pending: string; failed: string[] }
export type AcceptanceState =
    | { kind: "awaiting"; current: string; pending: string }
    | { kind: "ready"; current: string }
    | { kind: "blocked"; current: string; reasons: string[] }
    | { kind: "dao"; pending: string }

/**
 * - DAO controls: the DAO is the current authority (a pending address then means a staged return);
 * - Ready to accept: the DAO is the pending authority and every extra precondition holds;
 * - Blocked: the DAO is pending but the host would refuse the proposal;
 * - Awaiting publisher nomination: anything else.
 */
export function acceptanceState(read: AuthorityRead, dao: string): AcceptanceState {
    address.parse(dao)
    if (read.current === dao) return { kind: "dao", pending: read.pending }
    if (read.pending !== dao) return { kind: "awaiting", current: read.current, pending: read.pending }
    return read.failed.length ? { kind: "blocked", current: read.current, reasons: read.failed } : { kind: "ready", current: read.current }
}

export const ACCEPTANCE_LABELS: Record<AcceptanceState["kind"], string> = {
    awaiting: "Awaiting publisher nomination", ready: "Ready to accept", blocked: "Nominated, but the handoff would be refused", dao: "DAO controls",
}

/** The DAO's own address: acceptance is valid only when a target names exactly it. */
export function weightedDaoAddress(realmPath: string): string { return packageAddress(realmPath) }

const targetPath = z.enum(Object.values(APPLICATION_TARGETS) as [string, ...string[]])

/** Read one target's authority and, once the DAO is pending, the extra accept preconditions. */
export async function readTargetAuthority(ctx: WeightedContext, key: ApplicationPolicyKey, target: string, successor: string, signal?: AbortSignal): Promise<AuthorityRead> {
    targetPath.parse(target); address.parse(successor)
    const dao = weightedDaoAddress(ctx.realmPath)
    const getters = AUTHORITY_GETTERS[key]
    const [current, pending] = await Promise.all([
        qevalText(ctx.rpcUrl, target, `${getters.current}()`, signal).then(raw => parseQevalAddress(raw, getters.type)),
        qevalText(ctx.rpcUrl, target, `${getters.pending}()`, signal).then(raw => parseQevalAddress(raw, getters.type)),
    ])
    const failed: string[] = []
    if (pending === dao && current !== dao) {
        if (current === "") throw new Error("Target has no current authority")
        // The feedback host accepts only a handoff from the configured successor.
        if (key === "feedbackPolicy" && current !== successor) failed.push("The current owner is not the configured publisher, so the host refuses the handoff.")
        for (const probe of ACCEPT_PROBES[key] ?? []) {
            const raw = await qevalText(ctx.rpcUrl, target, probe.expression({ owner: current, dao }), signal)
            const value = typeof probe.expect === "boolean" ? parseQevalBool(raw) : parseQevalString(raw)
            if (value !== probe.expect) failed.push(probe.reason)
        }
    }
    return { current, pending, failed }
}

/** Every adapter's acceptance state, after checking the RPC serves the selected chain. */
export async function readAcceptanceStates(ctx: WeightedContext, policies: { key: ApplicationPolicyKey; policy: { target: string; successor: string } }[], signal?: AbortSignal) {
    await assertWeightedChain(ctx, signal)
    const dao = weightedDaoAddress(ctx.realmPath)
    const entries = await Promise.all(policies.map(({ key, policy }) => readTargetAuthority(ctx, key, policy.target, policy.successor, signal)
        .then(read => [key, acceptanceState(read, dao)] as const, () => [key, "error"] as const)))
    return Object.fromEntries(entries) as Partial<Record<ApplicationPolicyKey, AcceptanceState | "error">>
}

/**
 * The New proposal wizard's rules: the same validation and actions as the
 * classic form (components/proposal/ProposeV2Form.tsx), kept pure so they can
 * be tested. The draft shape is the classic one, stored under the classic
 * draft scope, so a draft started in either interface continues in the other.
 *
 * @module os/daos/proposal
 */
import type { DAOMember, DaoAction } from "../../lib/dao"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import type { ProposalDraft } from "../../lib/dao/governanceRecovery"
import type { DaoProposalKind } from "../../lib/dao/kind"
import type { MembaV2Config } from "../../lib/dao/membaV2"
import { v2DescriptionProblem, v2TitleProblem } from "../../lib/dao/v2Text"

export const TYPE_LABELS: Record<DaoProposalKind, string> = {
    text: "Text", add_member: "Add member", remove_member: "Remove member", change_role: "Change roles", archive: "Archive DAO",
}

export const TYPE_HINTS: Record<DaoProposalKind, string> = {
    text: "A decision recorded on chain, with no automatic effect.",
    add_member: "If executed, adds the address as a member with the voting power and roles below.",
    remove_member: "If executed, removes the member and their voting power.",
    change_role: "If executed, replaces the member's roles with the roles selected below.",
    archive: "If executed, the DAO is archived permanently: no more proposals, votes or executions.",
}

export const V2_MAX_POWER = 1_000_000_000

export type Field = "title" | "description" | "category" | "target" | "power" | "roles"

export function emptyDraft(kind: DaoProposalKind): ProposalDraft {
    return { kind, title: "", description: "", category: null, target: "", powerText: "1", roles: null }
}

export function parsePower(raw: string): number | null {
    const digits = raw.replace(/[\s,_]/g, "")
    if (!/^[0-9]{1,10}$/.test(digits)) return null
    const n = Number(digits)
    return n >= 1 && n <= V2_MAX_POWER ? n : null
}

export const needsTarget = (k: DaoProposalKind) => k === "add_member" || k === "remove_member" || k === "change_role"
export const needsRoles = (k: DaoProposalKind) => k === "add_member" || k === "change_role"

/** What the form resolves to: problems per field, and the action when there are none. */
export function evaluateProposal(d: ProposalDraft, config: Pick<MembaV2Config, "categories" | "roles">, members: readonly DAOMember[]) {
    const kind = d.kind
    const target = d.target.trim()
    const targetMember = members.find((m) => m.address === target) ?? null
    const category = d.category ?? config.categories[0]
    const roles = (d.roles ?? (kind === "change_role" && targetMember ? targetMember.roles : [])).filter((r) => config.roles.includes(r))
    const power = parsePower(d.powerText)
    const totalPower = members.reduce((sum, m) => sum + m.votingPower, 0)

    const problems: Partial<Record<Field, string>> = {}
    const titleProblem = v2TitleProblem(d.title)
    if (titleProblem) problems.title = titleProblem
    const descriptionProblem = v2DescriptionProblem(d.description)
    if (descriptionProblem) problems.description = descriptionProblem
    if (kind === "text" && !config.categories.includes(category)) problems.category = "Choose one of the DAO's categories."
    if (needsTarget(kind)) {
        if (!target) problems.target = "Enter the member's address."
        else if (!isValidGnoAddressChecksum(target)) problems.target = "This is not a valid gno.land address."
        else if (target !== target.toLowerCase()) problems.target = "Enter the address in lower case."
        else if (kind === "add_member" && targetMember) problems.target = "This address is already a member."
        else if (kind !== "add_member" && !targetMember) problems.target = "This address is not a member of the DAO."
        else if (kind === "remove_member" && targetMember && (members.length <= 1 || totalPower - targetMember.votingPower < 1)) problems.target = "Removing this member would leave the DAO without voting power."
    }
    if (kind === "add_member") {
        if (power === null) problems.power = `Voting power must be a whole number from 1 to ${V2_MAX_POWER.toLocaleString("en-US")}.`
        if (members.length >= 100) problems.target = "This DAO already has the maximum of 100 members."
    }
    if (needsRoles(kind) && roles.length !== (d.roles ?? roles).length) problems.roles = "Some roles are not roles of this DAO."

    let action: DaoAction | null = null
    if (Object.keys(problems).length === 0) {
        const t = d.title
        const desc = d.description
        switch (kind) {
            case "text": action = { type: "propose-text", title: t, description: desc, category }; break
            case "add_member": action = { type: "propose-add-member", title: t, description: desc, target, power: power!, roles }; break
            case "remove_member": action = { type: "propose-remove-member", title: t, description: desc, target }; break
            case "change_role": action = { type: "propose-change-role", title: t, description: desc, target, roles }; break
            case "archive": action = { type: "propose-archive", title: t, description: desc }; break
        }
    }
    return { problems, action, category, roles, power, target, targetMember, totalPower }
}

/** One plain sentence: what happens if the proposal passes and is executed. */
export function proposalEffect(d: ProposalDraft, e: ReturnType<typeof evaluateProposal>, daoName: string): string {
    switch (d.kind) {
        case "text": return "Nothing changes on chain. It records the decision."
        case "add_member": return `${e.target || "—"} joins with voting power ${e.power ?? "—"} (total ${e.totalPower} → ${e.totalPower + (e.power ?? 0)})${e.roles.length ? ` and roles ${e.roles.join(", ")}` : ""}.`
        case "remove_member": return `${e.target || "—"} loses their voting power in ${daoName}.`
        case "change_role": return `${e.target || "—"}'s roles become ${e.roles.length ? e.roles.join(", ") : "none"}.`
        case "archive": return `${daoName} is archived for good. No more proposals.`
    }
}

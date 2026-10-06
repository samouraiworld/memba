/**
 * What a member fills in to propose a memba_gov action. A roster action is
 * encoded here; an app action is a call to a bridge entrypoint, which the
 * bridge itself turns into the exact proposal (readBridgeApproval), so the
 * pre-state an approval binds is never rebuilt by Memba.
 */
import { encodeArgs, type DaoauthTag } from "./daoauth"
import { BRIDGE_PATH, CRITICAL, FINANCIAL, GOV_PATH, ROUTINE, bridgeEntrypoint, bridgeOpApplies, type GovValueKind } from "./govActions"

export type GovInput = { label: string; tag: DaoauthTag; kind?: GovValueKind; options?: readonly string[] }

const holder: GovInput[] = [{ label: "Address", tag: "a" }]
const member: GovInput[] = [{ label: "Member address", tag: "a" }, { label: "Roles (ordered: admin,dev,ops,member)", tag: "s" }]

/** The bridge entrypoint's parameters after the proposal id and the app, in order. */
export const BRIDGE_INPUTS: Record<string, { title: string; inputs: GovInput[] }> = {
    TransferAdmin: { title: "Hand the admin role to", inputs: [{ label: "New admin", tag: "a" }] },
    CancelTransfer: { title: "Withdraw the staged admin hand-over", inputs: [] },
    SetPause: { title: "Pause until a date, or end the pause", inputs: [{ label: "Paused until (0 ends the pause now)", tag: "i", kind: "time" }] },
    Grant: { title: "Grant the app's role", inputs: holder },
    Revoke: { title: "Revoke the app's role", inputs: holder },
    Curate: { title: "Curate a listing", inputs: [{ label: "Operation", tag: "s", options: ["approve", "reject", "delist", "restore", "clearflags"] }, { label: "Listing (package path)", tag: "s" }, { label: "Reason (reject only)", tag: "s" }] },
    SetRegistrationFee: { title: "Set the registration fee", inputs: [{ label: "New fee", tag: "i", kind: "ugnot" }] },
    SetTreasury: { title: "Send the app's fees to", inputs: [{ label: "New treasury", tag: "a" }] },
    SetFee: { title: "Set a market fee", inputs: [{ label: "Lane", tag: "s" }, { label: "New fee", tag: "i", kind: "bps" }] },
    ResolveDispute: { title: "Settle an escrow dispute", inputs: [{ label: "Contract", tag: "s" }, { label: "Milestone (from 0)", tag: "i" }, { label: "Refund the client in full (otherwise pay the freelancer)", tag: "b" }] },
    ProposeFeeRecipient: { title: "Stage the fallback fee recipient", inputs: [{ label: "New recipient", tag: "a" }] },
    CancelFeeRecipient: { title: "Withdraw the staged fee recipient", inputs: [] },
    HideReview: { title: "Hide a review", inputs: [{ label: "Review id", tag: "u" }] },
    HideComment: { title: "Hide a comment", inputs: [{ label: "Comment id", tag: "u" }] },
    Unhide: { title: "Show a review or comment again", inputs: [{ label: "Item id", tag: "u" }] },
    SetSigner: { title: "Rotate the quest signer key", inputs: [{ label: "New public key (64 hex digits)", tag: "s" }] },
    AddMember: { title: "Add a member", inputs: member },
    RemoveMember: { title: "Remove a member", inputs: [{ label: "Member address", tag: "a" }] },
    SetRoles: { title: "Change a member's roles", inputs: member },
    CreateChannel: { title: "Create a channel (permanent)", inputs: [{ label: "Name", tag: "s" }, { label: "Description (1-200 characters)", tag: "s" }, { label: "Type", tag: "s", options: ["text", "announcements", "readonly"] }] },
}

/** The ops a member can propose for an app. */
export const opsFor = (app: string) => Object.keys(BRIDGE_INPUTS).filter((op) => bridgeOpApplies(op, app))

/** The daoauth call the bridge's Approval read takes for this entrypoint, app and values. */
export function bridgeDraftCall(op: string, app: string, values: readonly string[]): string {
    const spec = BRIDGE_INPUTS[op]
    if (!spec || !bridgeOpApplies(op, app)) throw new Error("This action does not apply to that app")
    const { func, takesApp } = bridgeEntrypoint(op)
    return encodeArgs([
        { tag: "s", value: func },
        ...(takesApp ? [{ tag: "s" as const, value: app }] : []),
        ...spec.inputs.map((input, i) => ({ tag: input.tag, value: values[i] ?? "" })),
    ])
}

/** memba_gov's roster actions: the core fixes their class and scope. */
export const ROSTER_INPUTS: Record<string, { title: string; class: number; inputs: GovInput[] }> = {
    AddMember: { title: "Invite a new member", class: CRITICAL, inputs: [{ label: "Person id (a-z, 0-9, _ or -)", tag: "s" }, { label: "Key", tag: "a" }, { label: "Weight", tag: "u", options: ["1", "2"] }] },
    RemoveMember: { title: "Remove a member", class: CRITICAL, inputs: [{ label: "Person id", tag: "s" }] },
    SetWeight: { title: "Change a member's weight", class: CRITICAL, inputs: [{ label: "Person id", tag: "s" }, { label: "New weight", tag: "u", options: ["1", "2"] }] },
    Recover: { title: "Recover a member's key", class: CRITICAL, inputs: [{ label: "Person id", tag: "s" }, { label: "New key", tag: "a" }] },
    RemoveInactive: { title: "Remove an inactive member", class: ROUTINE, inputs: [{ label: "Person id", tag: "s" }] },
    Uninvite: { title: "Revoke an invitation", class: FINANCIAL, inputs: [{ label: "Person id", tag: "s" }] },
}

export type GovDraft = { target: string; action: string; args: string; scope: string; class: number; note: string }

export function rosterDraft(action: string, values: readonly string[], note: string): GovDraft {
    const spec = ROSTER_INPUTS[action]
    if (!spec) throw new Error("Unknown roster action")
    // Every roster action names its person first: memba_gov's id rule.
    if (!/^[a-z0-9_-]{1,32}$/.test(values[0] ?? "")) throw new Error("A person id is 1 to 32 of a-z, 0-9, _ or -.")
    return { target: GOV_PATH, action, args: encodeArgs(spec.inputs.map((input, i) => ({ tag: input.tag, value: values[i] ?? "" }))), scope: "", class: spec.class, note }
}

export const isBridgeDraft = (d: GovDraft) => d.target === BRIDGE_PATH

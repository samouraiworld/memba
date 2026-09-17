/**
 * Human text for errors from version-2 DAO realms (template memba-dao/2).
 *
 * The realm refuses a call with a fixed panic message (templates/dao/v2/realm.ts).
 * Wallets and RPCs wrap it in stack traces; this maps the message to one
 * sentence a member can act on, and falls back to the generic friendlyError.
 */
import { friendlyError, extractMessage } from "../errorMessages"

// Longer messages first where one contains another.
const V2_MESSAGES: [string, string][] = [
    ["proposal is not accepted, or its execution window has passed", "This proposal cannot be executed: it was not accepted, or its execution window has closed."],
    ["execution delay has not elapsed", "This proposal cannot be executed yet. Wait until the execution delay has passed."],
    ["execution window has passed", "The execution window for this proposal has closed."],
    ["proposal invalidated by a membership change", "Membership changed after this proposal was created, so it can no longer be voted on."],
    ["proposal is not open for voting", "This proposal is no longer open for voting."],
    ["voting period has ended", "The voting period for this proposal has ended."],
    ["already voted", "You already voted on this proposal. Votes are final."],
    ["invalid vote: must be YES, NO or ABSTAIN", "Choose Yes, No or Abstain."],
    ["too many open proposals for this member", "You already have 10 proposals open for voting. Wait until one of them closes."],
    ["invalid proposal category", "This category is not one of the DAO's proposal categories."],
    ["title must not contain invisible formatting characters", "The title contains invisible formatting characters. Remove them and try again."],
    ["title must be a single line without control characters", "The title must be a single line without control characters."],
    ["title must be 1 to 128 characters", "The title must be 1 to 128 characters long."],
    ["title must not be blank", "The title cannot be blank."],
    ["title must be valid UTF-8", "The title contains invalid characters."],
    ["description must be at most 8000 characters", "The description must be at most 8,000 characters long."],
    ["description contains control characters", "The description contains control characters. Only line breaks and tabs are allowed."],
    ["description must be valid UTF-8", "The description contains invalid characters."],
    ["this action takes no target, power or roles", "This proposal type takes no member, voting power or roles."],
    ["member address must be lower case", "Enter the member address in lower case."],
    ["invalid member address", "The member address is not a valid gno.land address."],
    ["address is already a member", "This address is already a member of the DAO."],
    ["member power must be between 1 and 1000000000", "Voting power must be between 1 and 1,000,000,000."],
    ["member limit reached", "This DAO already has the maximum of 100 members."],
    ["target is not a member", "This address is not a member of the DAO."],
    ["cannot remove the last member", "This removal would leave the DAO without members or voting power."],
    ["too many roles", "Too many roles selected."],
    ["duplicate role", "A role is selected twice."],
    ["invalid role", "One of the selected roles is not a role of this DAO."],
    ["unknown action kind", "This proposal type is not supported by the DAO."],
    ["proposal not found", "This proposal does not exist."],
    ["caller is not a member", "Your connected wallet is not a member of this DAO."],
    ["DAO is archived", "This DAO is archived. It no longer accepts proposals, votes or executions."],
    ["not enough deposit to cover the storage usage", "The storage deposit limit was too low for this transaction. Nothing was charged for storage; try again."],
]

/** The friendly message for a version-2 DAO call failure. */
export function friendlyDaoError(error: unknown): string {
    const raw = extractMessage(error)
    for (const [needle, message] of V2_MESSAGES) {
        if (raw.includes(needle)) return message
    }
    return friendlyError(error)
}

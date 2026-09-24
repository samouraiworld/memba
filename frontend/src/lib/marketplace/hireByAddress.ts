/**
 * hireByAddress.ts — the "Hire by address" form's checks: a client hires a
 * freelancer they already know, by address, on milestones they write.
 *
 * Every check is the realm-parity check the builders already run
 * (builders.ts, escrow_v4 CreateContract): the form only turns the typed GNOT
 * amounts into exact ugnot and says which field a refusal is about. The result
 * is the listing shape the hire dialog plans from, so the dialog signs the
 * same CreateContract the form checked.
 */
import { isValidGnoAddressChecksum } from "../dao/address"
import { ESCROW_LIMITS, EscrowInputError, encodeMilestones, type EscrowMilestone } from "./builders"
import { planCreateContract, type HireableService } from "./escrowTx"

export interface HireDraftMilestone {
    title: string
    /** GNOT as typed: digits with up to 6 decimals. */
    amountGnot: string
}

export interface HireDraft {
    freelancer: string
    title: string
    description: string
    milestones: HireDraftMilestone[]
}

export type HireDraftField = "freelancer" | "title" | "description" | "milestones"

export type HireDraftCheck =
    | { ok: true; service: HireableService; milestones: EscrowMilestone[]; totalUgnot: bigint }
    | { ok: false; field: HireDraftField | null; message: string }

/**
 * Exact ugnot for a typed GNOT amount: at most 9 whole digits and 6 decimals, no
 * sign, exponent or separators. Never goes through a float.
 */
export function parseGnotInput(value: string): number {
    const s = value.trim()
    const m = /^(0|[1-9]\d{0,8})(?:\.(\d{1,6}))?$/.exec(s)
    if (!m) throw new EscrowInputError(`"${value}" is not an amount in GNOT (up to 6 decimals, for example 1.5)`)
    return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"))
}

const fail = (field: HireDraftField | null, message: string): HireDraftCheck => ({ ok: false, field, message })

/** The field a builder refusal is about, from its wording. */
function fieldOf(message: string): HireDraftField | null {
    if (/milestone/i.test(message)) return "milestones"
    if (/description/i.test(message)) return "description"
    if (/title/i.test(message)) return "title"
    if (/freelancer|hire yourself/i.test(message)) return "freelancer"
    return null
}

/** Check a draft for `caller` (the client) exactly as CreateContract would, and build the listing the hire dialog signs. */
export function checkHireDraft(caller: string, escrowPath: string, draft: HireDraft): HireDraftCheck {
    const freelancer = draft.freelancer.trim()
    if (!freelancer) return fail("freelancer", "Enter the freelancer's address.")
    if (!isValidGnoAddressChecksum(freelancer)) {
        return fail("freelancer", "This is not a valid gno.land address: check it letter by letter (the last characters are a checksum).")
    }
    if (caller && freelancer === caller) return fail("freelancer", "You cannot hire yourself: the escrow contract refuses a contract whose client is also the freelancer.")
    if (draft.milestones.length === 0) return fail("milestones", "Add at least one milestone.")
    if (draft.milestones.length > ESCROW_LIMITS.maxMilestones) return fail("milestones", `At most ${ESCROW_LIMITS.maxMilestones} milestones are allowed.`)
    let milestones: EscrowMilestone[]
    try {
        milestones = draft.milestones.map((m, i) => {
            try {
                return { title: m.title, amountUgnot: parseGnotInput(m.amountGnot) }
            } catch (err) {
                throw new EscrowInputError(`Milestone ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
            }
        })
        encodeMilestones(milestones)
    } catch (err) {
        return fail("milestones", err instanceof Error ? err.message : String(err))
    }
    if (!caller) return fail(null, "Connect your wallet to hire.")
    try {
        // The same builder the dialog signs with: title, description and every realm limit.
        planCreateContract(caller, escrowPath, { freelancer, title: draft.title, description: draft.description, milestones })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return fail(fieldOf(message), message)
    }
    return {
        ok: true,
        milestones,
        totalUgnot: milestones.reduce((sum, m) => sum + BigInt(m.amountUgnot), 0n),
        service: { freelancer, title: draft.title, description: draft.description, milestones: encodeMilestones(milestones) },
    }
}

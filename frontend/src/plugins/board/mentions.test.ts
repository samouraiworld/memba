/**
 * replyMentionsUser — @mention notification matching for channel replies.
 *
 * A reply notifies the connected user only when its body mentions the user's
 * exact full address, and never for the user's own reply. Addresses that
 * merely share leading characters with the user's must not match.
 */
import { describe, it, expect } from "vitest"
import { replyMentionsUser } from "./mentions"

const ADDR = "g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m"
/** Same first 10 characters as ADDR, different account. */
const LOOKALIKE = "g1aeddlftl" + "q".repeat(30)
const OTHER = "g1" + "q".repeat(38)
/** How the channels realm renders reply authors (truncAddr). */
const truncated = (addr: string) => `${addr.slice(0, 10)}...`

describe("replyMentionsUser", () => {
    it("matches a mention of the exact full address", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${ADDR} look` }, ADDR)).toBe(true)
    })

    it("matches regardless of the case of the connected address", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `@${ADDR}` }, ADDR.toUpperCase())).toBe(true)
    })

    it("does not match a mention of a lookalike address sharing the 10-character prefix", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${LOOKALIKE}` }, ADDR)).toBe(false)
    })

    it("does not match a truncated display form of the address", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${truncated(ADDR)}` }, ADDR)).toBe(false)
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${ADDR.slice(0, 10)}` }, ADDR)).toBe(false)
    })

    it("does not match the address embedded in a longer token", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${ADDR}x` }, ADDR)).toBe(false)
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey @${ADDR}7` }, ADDR)).toBe(false)
        expect(replyMentionsUser({ author: truncated(OTHER), body: `hey x@${ADDR}` }, ADDR)).toBe(false)
    })

    it("does not suppress a real mention because the author only shares the prefix", () => {
        // Reply authors are rendered truncated, so a lookalike author looks
        // identical to the user's own truncated address.
        expect(replyMentionsUser({ author: truncated(LOOKALIKE), body: `@${ADDR}` }, ADDR)).toBe(true)
        expect(replyMentionsUser({ author: LOOKALIKE, body: `@${ADDR}` }, ADDR)).toBe(true)
    })

    it("skips the user's own reply when the author is the exact full address", () => {
        expect(replyMentionsUser({ author: ADDR, body: `note to self @${ADDR}` }, ADDR)).toBe(false)
        expect(replyMentionsUser({ author: ADDR.toUpperCase(), body: `@${ADDR}` }, ADDR)).toBe(false)
    })

    it("never matches without a valid connected address", () => {
        expect(replyMentionsUser({ author: truncated(OTHER), body: `@${ADDR}` }, "")).toBe(false)
        expect(replyMentionsUser({ author: truncated(OTHER), body: `@${ADDR}` }, ADDR.slice(0, 10))).toBe(false)
    })
})

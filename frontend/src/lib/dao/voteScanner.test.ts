/**
 * Unit tests for voteScanner.ts — voter matching & cache logic.
 *
 * Tests the _isInVoterList function which determines whether a user
 * has already voted on a proposal. This is critical for Quick Vote,
 * notification dots, and My Votes accuracy.
 */
import { describe, it, expect } from 'vitest'
import { _isInVoterList, voterMatchesUser } from './voteScanner'

const ADDR = 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m'
/** Same first 10 characters as ADDR, different account. */
const LOOKALIKE = 'g1aeddlftlqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

// ── isInVoterList ──────────────────────────────────────────────

describe('isInVoterList', () => {
    const voters = [
        { username: '@zooma', profileUrl: 'https://gno.land/u/zooma' },
        { username: '@alice', profileUrl: 'https://gno.land/u/alice' },
        { username: 'g1abcdef1234', profileUrl: '' },
    ]

    // ── Username matching ──────────────────────────────────────

    it('matches exact username (without @)', () => {
        expect(_isInVoterList(voters, 'g1xxxxx', 'zooma')).toBe(true)
    })

    it('matches username with @ prefix in voter list', () => {
        expect(_isInVoterList(voters, 'g1xxxxx', 'alice')).toBe(true)
    })

    it('matches username case-insensitively', () => {
        expect(_isInVoterList(voters, 'g1xxxxx', 'ZooMa')).toBe(true)
        expect(_isInVoterList(voters, 'g1xxxxx', 'ALICE')).toBe(true)
    })

    it('returns false for non-matching username', () => {
        expect(_isInVoterList(voters, 'g1xxxxx', 'bob')).toBe(false)
    })

    // ── Address matching (exact full address only) ────────────
    // Voter entries are either "@username" or a full bech32 address, so a
    // voter is matched only by exact equality. The previous 10-character
    // prefix/substring match let a different account whose address or
    // username shares that prefix count as the user's vote.

    it('matches the exact full address, case-insensitively', () => {
        expect(_isInVoterList([{ username: ADDR }], ADDR, '')).toBe(true)
        expect(_isInVoterList([{ username: ADDR.toUpperCase() }], ADDR, '')).toBe(true)
    })

    it('does not match a voter whose address shares the 10-character prefix', () => {
        // Previously asserted true: 'g1abcdef1234' contains 'g1abcdef12'.
        expect(_isInVoterList(voters, 'g1abcdef1234567890', '')).toBe(false)
        expect(_isInVoterList([{ username: LOOKALIKE }], ADDR, '')).toBe(false)
    })

    // ── Edge cases ─────────────────────────────────────────────

    it('returns false for empty voter list', () => {
        expect(_isInVoterList([], 'g1addr', 'user')).toBe(false)
    })

    it('handles empty username gracefully', () => {
        expect(_isInVoterList(voters, 'g1notmatching', '')).toBe(false)
    })

    it('handles voter with @-prefixed username matching user without @', () => {
        const list = [{ username: '@bob' }]
        expect(_isInVoterList(list, 'g1xxxxx', 'bob')).toBe(true)
    })

    it('handles user with @ matching voter without @', () => {
        const list = [{ username: 'bob' }]
        expect(_isInVoterList(list, 'g1xxxxx', '@bob')).toBe(true)
    })

    it('does not match completely different users', () => {
        const list = [{ username: '@charlie' }]
        expect(_isInVoterList(list, 'g1zzzzzzzzzzz', 'dave')).toBe(false)
    })

    it('prioritizes username match over address match', () => {
        // If username matches, it should return true regardless of address
        const list = [{ username: '@zooma' }]
        expect(_isInVoterList(list, 'g1completelydifferent', 'zooma')).toBe(true)
    })
})

// ── voterMatchesUser ───────────────────────────────────────────

describe('voterMatchesUser', () => {
    it.each([
        ['a truncated address prefix', ADDR.slice(0, 10)],
        ['a display-truncated address', `${ADDR.slice(0, 10)}...${ADDR.slice(-4)}`],
        ['an address embedded in a longer entry', `${ADDR}x`],
        ['an address with a prefix before it', `x${ADDR}`],
        ['a lookalike address sharing the prefix', LOOKALIKE],
        ['a username containing the wallet prefix', `@${ADDR.slice(0, 10)}_fan`],
        ['a username equal to the wallet prefix', `@${ADDR.slice(0, 10)}`],
    ])('does not match %s', (_label, voter) => {
        expect(voterMatchesUser(voter, ADDR, 'alice')).toBe(false)
    })

    it('matches the exact full address and rejects a one-character change', () => {
        expect(voterMatchesUser(ADDR, ADDR, '')).toBe(true)
        expect(voterMatchesUser(ADDR.toUpperCase(), ADDR, null)).toBe(true)
        const changed = `${ADDR.slice(0, -1)}${ADDR.endsWith('q') ? 'p' : 'q'}`
        expect(voterMatchesUser(changed, ADDR, '')).toBe(false)
    })

    it('matches the exact username with or without @, case-insensitively', () => {
        expect(voterMatchesUser('@alice', ADDR, 'alice')).toBe(true)
        expect(voterMatchesUser('alice', ADDR, '@Alice')).toBe(true)
        expect(voterMatchesUser('@ALICE', ADDR, 'alice')).toBe(true)
    })

    it('does not match a near username', () => {
        for (const near of ['@alice1', '@alic', '@xalice', '@alice_', '@al ice']) {
            expect(voterMatchesUser(near, ADDR, 'alice')).toBe(false)
        }
    })

    it('never matches on empty values', () => {
        expect(voterMatchesUser('', ADDR, '')).toBe(false)
        expect(voterMatchesUser('@', ADDR, '')).toBe(false)
        expect(voterMatchesUser('', '', '')).toBe(false)
        expect(voterMatchesUser('@alice', '', '')).toBe(false)
    })

    it('does not treat a malformed user address as matchable', () => {
        expect(voterMatchesUser('g1short', 'g1short', '')).toBe(false)
    })
})

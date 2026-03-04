/**
 * Unit tests for voteScanner.ts — voter matching & cache logic.
 *
 * Tests the _isInVoterList function which determines whether a user
 * has already voted on a proposal. This is critical for Quick Vote,
 * notification dots, and My Votes accuracy.
 */
import { describe, it, expect } from 'vitest'
import { _isInVoterList } from './voteScanner'

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

    // ── Address matching (partial prefix) ──────────────────────

    it('matches by address prefix (at least 10 chars)', () => {
        // Voter username is 'g1abcdef1234' — address prefix 'g1abcdef12' should match
        expect(_isInVoterList(voters, 'g1abcdef1234567890', '')).toBe(true)
    })

    it('does not false-match with very short prefix', () => {
        // Address prefix is always 10 chars — this tests that the prefix is long enough
        expect(_isInVoterList(
            [{ username: 'g1x' }],
            'g1xZZZZZZZZZZZZZZZZ',
            ''
        )).toBe(false)
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

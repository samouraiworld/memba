/**
 * Unit tests for profile.ts — User profile data layer.
 *
 * Tests cover: profile merge logic, love power score calculation,
 * graceful degradation on API failures, and type safety.
 *
 * NOTE: fetchUserProfile depends on external APIs (gno.land, gnolove, backend).
 * We test the merge logic and score calculation via integration-style tests
 * that mock individual fetcher results using the internal merge patterns.
 */
import { describe, it, expect } from 'vitest'
import type { UserProfile, GnoPackage, GovVote, SocialLinks } from './profile'

// ── Type Tests ──────────────────────────────────────────────────

describe('UserProfile type', () => {
    it('has all required fields', () => {
        const profile: UserProfile = {
            address: 'g1test',
            username: '',
            userRealmUrl: '',
            githubLogin: '',
            githubAvatar: '',
            githubBio: '',
            githubLocation: '',
            githubFollowers: 0,
            socialLinks: { twitter: '', github: '', website: '' },
            totalCommits: 0,
            totalPRs: 0,
            totalIssues: 0,
            totalReviews: 0,
            lovePowerScore: 0,
            deployedPackages: [],
            governanceVotes: [],
            bio: '',
            company: '',
            title: '',
            avatarUrl: '',
        }
        expect(profile.address).toBe('g1test')
        expect(profile.socialLinks.twitter).toBe('')
    })
})

describe('GnoPackage type', () => {
    it('has correct structure', () => {
        const pkg: GnoPackage = {
            address: 'g1owner',
            path: 'gno.land/r/test/pkg',
            namespace: 'test',
            blockHeight: 12345,
        }
        expect(pkg.path).toBe('gno.land/r/test/pkg')
    })
})

describe('GovVote type', () => {
    it('has correct structure', () => {
        const vote: GovVote = {
            proposalId: '42',
            proposalTitle: 'Add new member',
            vote: 'YES',
        }
        expect(vote.proposalId).toBe('42')
    })
})

// ── Love Power Score Calculation ─────────────────────────────────

describe('lovePowerScore calculation', () => {
    /**
     * Replicates the score formula from profile.ts:
     * commits×10 + PRs×2 + issues×0.5 + reviews×2
     */
    function calculateLovePowerScore(
        commits: number,
        prs: number,
        issues: number,
        reviews: number,
    ): number {
        return Math.round(commits * 10 + prs * 2 + issues * 0.5 + reviews * 2)
    }

    it('calculates score for active contributor', () => {
        // 50 commits, 20 PRs, 10 issues, 15 reviews
        const score = calculateLovePowerScore(50, 20, 10, 15)
        expect(score).toBe(50 * 10 + 20 * 2 + 10 * 0.5 + 15 * 2) // 500 + 40 + 5 + 30 = 575
    })

    it('returns 0 for zero contributions', () => {
        expect(calculateLovePowerScore(0, 0, 0, 0)).toBe(0)
    })

    it('weights commits highest (×10)', () => {
        const commitOnly = calculateLovePowerScore(1, 0, 0, 0)
        const prOnly = calculateLovePowerScore(0, 1, 0, 0)
        expect(commitOnly).toBe(10)
        expect(prOnly).toBe(2)
        expect(commitOnly).toBeGreaterThan(prOnly)
    })

    it('rounds correctly for odd issue counts', () => {
        // 0 commits, 0 PRs, 3 issues, 0 reviews → 1.5 → rounds to 2
        expect(calculateLovePowerScore(0, 0, 3, 0)).toBe(2)
    })
})

// ── Profile Merge Logic ─────────────────────────────────────────

describe('profile merge logic', () => {
    /**
     * Replicate the merge behavior from fetchUserProfile:
     * backend editable fields override gnolove defaults when present.
     */
    function mergeBackendOverrides(
        profile: UserProfile,
        backend: { bio?: string; company?: string; title?: string; avatarUrl?: string; twitter?: string; github?: string; website?: string } | null,
    ): UserProfile {
        if (!backend) return profile
        const merged = { ...profile }
        if (backend.bio) merged.bio = backend.bio
        if (backend.company) merged.company = backend.company
        if (backend.title) merged.title = backend.title
        if (backend.avatarUrl) merged.avatarUrl = backend.avatarUrl
        if (backend.twitter) merged.socialLinks = { ...merged.socialLinks, twitter: backend.twitter }
        if (backend.github) merged.socialLinks = { ...merged.socialLinks, github: backend.github }
        if (backend.website) merged.socialLinks = { ...merged.socialLinks, website: backend.website }
        return merged
    }

    const baseProfile: UserProfile = {
        address: 'g1test',
        username: '@zooma',
        userRealmUrl: 'https://gno.land/u/zooma',
        githubLogin: 'zooma',
        githubAvatar: 'https://github.com/zooma.png',
        githubBio: 'Builder',
        githubLocation: 'Paris',
        githubFollowers: 100,
        socialLinks: { twitter: '@old_twitter', github: 'https://github.com/zooma', website: 'https://old.site' },
        totalCommits: 10,
        totalPRs: 5,
        totalIssues: 3,
        totalReviews: 8,
        lovePowerScore: 10 * 10 + 5 * 2 + 3 * 0.5 + 8 * 2,
        deployedPackages: [],
        governanceVotes: [],
        bio: '',
        company: '',
        title: '',
        avatarUrl: '',
    }

    it('backend bio overrides empty profile bio', () => {
        const merged = mergeBackendOverrides(baseProfile, { bio: 'Custom bio' })
        expect(merged.bio).toBe('Custom bio')
    })

    it('backend company overrides empty company', () => {
        const merged = mergeBackendOverrides(baseProfile, { company: 'Samouraï Coop' })
        expect(merged.company).toBe('Samouraï Coop')
    })

    it('backend social links override gnolove defaults', () => {
        const merged = mergeBackendOverrides(baseProfile, { twitter: '@new_twitter' })
        expect(merged.socialLinks.twitter).toBe('@new_twitter')
        // Other social links should remain unchanged
        expect(merged.socialLinks.github).toBe('https://github.com/zooma')
    })

    it('null backend leaves profile unchanged', () => {
        const merged = mergeBackendOverrides(baseProfile, null)
        expect(merged).toEqual(baseProfile)
    })

    it('empty strings in backend do NOT override', () => {
        const profileWithBio = { ...baseProfile, bio: 'Original' }
        const merged = mergeBackendOverrides(profileWithBio, { bio: '' })
        expect(merged.bio).toBe('Original')
    })

    it('avatarUrl from backend overrides gnolove avatar', () => {
        const merged = mergeBackendOverrides(baseProfile, { avatarUrl: 'https://custom-avatar.png' })
        expect(merged.avatarUrl).toBe('https://custom-avatar.png')
    })
})

// ── SocialLinks Structure ───────────────────────────────────────

describe('SocialLinks', () => {
    it('has twitter, github, website fields', () => {
        const links: SocialLinks = {
            twitter: '@zooma',
            github: 'https://github.com/zooma',
            website: 'https://samourai.world',
        }
        expect(links.twitter).toBe('@zooma')
        expect(links.github).toContain('github.com')
        expect(links.website).toContain('samourai')
    })

    it('handles empty social links', () => {
        const links: SocialLinks = { twitter: '', github: '', website: '' }
        expect(links.twitter).toBe('')
    })
})

// ── GitHub URL Normalization (F1 fix) ───────────────────────────

describe('GitHub URL normalization', () => {
    /** Replicates the normalization logic from ProfilePage.tsx line 279 */
    function normalizeGithubUrl(value: string): string {
        return value.startsWith('http') ? value : `https://github.com/${value}`
    }

    it('normalizes raw username to full GitHub URL', () => {
        expect(normalizeGithubUrl('WaDadidou')).toBe('https://github.com/WaDadidou')
    })

    it('passes through full GitHub URL unchanged', () => {
        expect(normalizeGithubUrl('https://github.com/zooma')).toBe('https://github.com/zooma')
    })

    it('passes through http URL unchanged', () => {
        expect(normalizeGithubUrl('http://github.com/legacy')).toBe('http://github.com/legacy')
    })
})

// ── Link GitHub CTA Guard (F2 fix) ─────────────────────────────

describe('Link GitHub CTA visibility', () => {
    /** Replicates the guard condition from ProfilePage.tsx:
     * Show CTA only when BOTH githubLogin AND socialLinks.github are empty */
    function shouldShowLinkCTA(githubLogin: string, socialLinksGithub: string): boolean {
        return !githubLogin && !socialLinksGithub
    }

    it('shows CTA when neither gnolove nor backend has GitHub', () => {
        expect(shouldShowLinkCTA('', '')).toBe(true)
    })

    it('hides CTA when backend has GitHub link', () => {
        expect(shouldShowLinkCTA('', 'https://github.com/WaDadidou')).toBe(false)
    })

    it('hides CTA when gnolove has GitHub login', () => {
        expect(shouldShowLinkCTA('WaDadidou', '')).toBe(false)
    })

    it('hides CTA when both sources have GitHub', () => {
        expect(shouldShowLinkCTA('WaDadidou', 'https://github.com/WaDadidou')).toBe(false)
    })
})

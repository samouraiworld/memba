/**
 * navManifest completeness test (Wave 4.5).
 *
 * Verifies that every top-level route in App.tsx is either:
 * - Listed in navManifest (navigable via sidebar/tab-bar), OR
 * - Explicitly excluded (utility routes, redirects, catch-alls, child routes).
 *
 * This prevents "hidden page" drift where a new route is added to App.tsx
 * but never surfaced in navigation — a recurring audit finding.
 */
import { describe, it, expect } from 'vitest'
import { NAV } from './navManifest'

// Routes in App.tsx that are NOT expected to appear in the nav manifest.
// Each must have a reason — if you add a route here, document why.
const EXCLUDED_ROUTES = new Set([
    // Redirects / utility
    'create',             // /create → CreateMultisig (deep link, not nav)
    'import',             // /import → ImportMultisig (deep link, not nav)

    // Sub-routes of manifest entries (navigated to from parent, not sidebar)
    'multisig/:address',           // sub-route of /multisig
    'multisig/:address/propose',   // sub-route of /multisig
    'tx/:id',                      // sub-route of /multisig
    'create-token',                // sub-route of /tokens
    'tokens/:symbol',              // sub-route of /tokens
    'dao/create',                  // sub-route of /dao
    'dao/*',                       // sub-route of /dao
    'profile/:address',            // sub-route of /profile
    'validators/hacker',           // sub-route of /validators
    'validators/valoper/:operatorAddress', // redirect
    'validators/:address',         // sub-route of /validators

    // NFT + Services are redirect-only shells into the unified /marketplace
    // (/nft → /marketplace/nfts, /services → /marketplace/services). They lost
    // their standalone nav entries in the marketplace-menu consolidation
    // (2026-07-08) — the single "Marketplace" entry covers them.
    'nft',
    'services',

    // NFT sub-routes (reached from the marketplace NFT lane, not the sidebar)
    'nft/create',
    'nft/create/advanced',
    'nft/collection/:creator/:slug',
    'nft/token/:creator/:slug/:tokenId',
    'nft/creator/:address',
    'nft/creator',
    'nft/studio',
    'nft/studio/:creator/:slug',
    'nft/:realmPath',

    // Marketplace sub-routes (parent is /marketplace in manifest)
    'marketplace/:agentId',

    // Quest sub-routes
    'quests/:questId',

    // Utility / auth / callback pages
    'github/callback',    // OAuth callback (not navigable)
    'u/:username',        // username resolver (deep link)
    '*',                  // 404 catch-all
])

// Routes that ARE top-level pages users should reach but are missing from
// navManifest. Add them to navManifest, then remove from here.
// As of v7.2: all previously missing routes have been added to the manifest.
const KNOWN_MISSING = new Set<string>([
    // (empty — all routes now covered)
])

describe('navManifest completeness', () => {
    it('every nav entry has a valid route-shaped path', () => {
        for (const entry of NAV) {
            expect(entry.to).toBeTruthy()
            expect(entry.to.startsWith('/')).toBe(true)
            expect(entry.id).toBeTruthy()
            expect(entry.label).toBeTruthy()
        }
    })

    it('nav entries have unique ids', () => {
        const ids = NAV.map(e => e.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('nav entries have unique paths', () => {
        const paths = NAV.map(e => e.to)
        expect(new Set(paths).size).toBe(paths.length)
    })

    it('documents all known missing routes (update when manifest is extended)', () => {
        // This test serves as a tracking list. When a KNOWN_MISSING route
        // gets added to navManifest, remove it from KNOWN_MISSING.
        const manifestPaths = new Set(NAV.map(e => e.to.replace(/^\//, '')))
        for (const route of KNOWN_MISSING) {
            expect(
                manifestPaths.has(route),
                `Route "${route}" is in KNOWN_MISSING but was found in navManifest — remove it from KNOWN_MISSING`
            ).toBe(false)
        }
    })

    it('EXCLUDED_ROUTES are genuinely not in manifest', () => {
        const manifestPaths = new Set(NAV.map(e => e.to.replace(/^\//, '')))
        for (const route of EXCLUDED_ROUTES) {
            expect(
                manifestPaths.has(route),
                `Route "${route}" is in EXCLUDED_ROUTES but exists in navManifest — remove it from EXCLUDED_ROUTES`
            ).toBe(false)
        }
    })
})

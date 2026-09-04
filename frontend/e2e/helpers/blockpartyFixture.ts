import type { Page } from '@playwright/test'

/**
 * Deterministic Block Party backend stub for the flag-ON e2e (blockparty.spec).
 * The game reads exclusively from the memba-backend ConnectRPC endpoints, so
 * with no backend on :5174 every query rejects — which is exactly the state
 * the old spec silently passed in (the game-over sheet fired on the 0-budget
 * placeholder before the fix). This helper FULFILLS the three read RPCs with a
 * canned challenge so the spec exercises a real seeded run.
 *
 * Interception requires an ABSOLUTE API base: connect-web issues same-origin
 * requests that page.route cannot see when API_BASE_URL is "" — the recorded
 * lesson from .env.e2e-feed. Root .env.e2e therefore pins VITE_API_URL to the
 * :5174 origin.
 *
 * JSON wire notes (match the live backend): 64-bit fields (par, blockHeight)
 * are STRINGS; 32-bit (seed, moveBudget) are numbers.
 */

export const BP_SEED = 12345
export const BP_BUDGET = 30
export const BP_HEIGHT = '99236'
export const BP_HASH = 's0leQ+7nRr7v1Aj2YwZPZR4IC5qNWCxL03SPxcDpfPo='

export function bpTodayUTC(): string {
    return new Date().toISOString().slice(0, 10)
}

export async function stubBlockPartyBackend(page: Page): Promise<void> {
    await page.route('**/memba.v1.MultisigService/GetDailyChallenge', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                date: bpTodayUTC(),
                seed: BP_SEED,
                modifier: 'standard',
                par: '1500',
                moveBudget: BP_BUDGET,
                blockHeight: BP_HEIGHT,
                blockHash: BP_HASH,
                ready: true,
            }),
        }),
    )
    await page.route('**/memba.v1.MultisigService/GetDailyLeaderboard', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries: [] }) }),
    )
    await page.route('**/memba.v1.MultisigService/GetStreak', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ streak: { current: 0, longest: 0, freezesRemaining: 1 } }),
        }),
    )
}

/** A ready challenge whose leaderboard dependency fails independently. */
export async function stubBlockPartyLeaderboardDown(page: Page): Promise<void> {
    await stubBlockPartyBackend(page)
    // Playwright routes are evaluated newest-first, so this deliberately
    // overrides the healthy leaderboard route installed above.
    await page.route('**/memba.v1.MultisigService/GetDailyLeaderboard', (route) =>
        route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    )
}

/** The failure-path stub: the challenge endpoint answers 500 on every attempt. */
export async function stubBlockPartyBackendDown(page: Page): Promise<void> {
    await page.route('**/memba.v1.MultisigService/GetDailyChallenge', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
}

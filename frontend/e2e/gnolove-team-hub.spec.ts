import { test, expect } from "@playwright/test"

// Live-RPC suite: runs serial (single worker) so its on-chain reads don't
// double-load the gnolove API under parallel workers. See playwright.config.ts.
test.describe.configure({ mode: 'serial' })

/**
 * Gnolove Team Hub canary.
 *
 * Smoke tests that `/gnolove/teams/:slug` renders end-to-end against
 * the live gnolove backend, and that the period selector / URL-state
 * contract holds. Backend health auto-degrade is covered by the unit
 * test next to `useGnoloveBackendHealth`.
 *
 * Data source: backend.gnolove.world (the live prod backend). Tests
 * tolerate a backend hiccup with a soft skip rather than failing the
 * suite — the canary's job is to surface frontend regressions, not
 * to alarm on every transient 502.
 */

const TEAM_SLUG = "samouraiworld"
const HUB_PATH = `/gnoland1/gnolove/teams/${TEAM_SLUG}`
const ANALYTICS_PATH = "/gnoland1/gnolove/analytics"

test.describe("Gnolove Team Hub canary", () => {
    test("hub renders for a known team", async ({ page }) => {
        await page.goto(HUB_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

        const hub = page.locator(".gl-thub-page")
        await expect(hub).toBeVisible({ timeout: 10_000 })

        // Each of the six cards from the plan §2 should render. Title text
        // changes over time; assert structure not copy. The metrics grid
        // doesn't use a .gl-thub-card-title (no h2), so we expect 4
        // titled cards (Active repos / Focus areas / Recent / AI report).
        await expect(page.locator(".gl-thub-card").first()).toBeVisible()
        const titleCount = await page.locator(".gl-thub-card-title").count()
        expect(titleCount).toBeGreaterThanOrEqual(3)
    })

    test("'Roster updated' chip is present in the header", async ({ page }) => {
        await page.goto(HUB_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

        // v6.2.2 renamed the chip from "Last sync" to "Roster updated"
        // — assert the new label so accidental reverts trip CI.
        await expect(page.locator(".gl-thub-chip-sync")).toContainText(/Roster updated/i, { timeout: 10_000 })
    })

    test("period tablist drives URL state", async ({ page }) => {
        await page.goto(HUB_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

        const tablist = page.getByRole("tablist", { name: /Period/i })
        await expect(tablist).toBeVisible({ timeout: 10_000 })

        // Click the "Last week" tab → URL should reflect the new period via
        // useTeamProfileUrlState's `?time=`. Labels come from
        // TEAM_HUB_PERIOD_LABELS (gnolovePeriod.ts) — "Last week", not "Weekly".
        await tablist.getByRole("tab", { name: /Last week/i }).click()
        // The hub stores the period in URL state; assert any of the
        // expected shapes the codec uses today.
        await expect(page).toHaveURL(/(time|period)=weekly/i, { timeout: 5_000 })
    })

    test("network chip is hidden on gnoland1 and shown on test13", async ({ page }) => {
        // gnoland1 = real chain → no "Data: mainnet" chip.
        await page.goto(HUB_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
        await expect(page.locator(".gl-thub-chip-network")).toHaveCount(0)

        // test13 = test chain → chip present.
        await page.goto(`/test13/gnolove/teams/${TEAM_SLUG}`)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
        await expect(page.locator(".gl-thub-chip-network")).toContainText(/Data: mainnet/i, { timeout: 10_000 })
    })
})

test.describe("Gnolove Analytics canary", () => {
    test("period tablist + URL state", async ({ page }) => {
        await page.goto(ANALYTICS_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

        const tablist = page.getByRole("tablist", { name: /Time period/i })
        await expect(tablist).toBeVisible({ timeout: 10_000 })

        await tablist.getByRole("tab", { name: /This Month/i }).click()
        await expect(page).toHaveURL(/time=monthly/, { timeout: 5_000 })
    })

    test("all 5 plan §2 panels render", async ({ page }) => {
        // Pick a period with enough data so every panel has signal.
        await page.goto(`${ANALYTICS_PATH}?time=yearly`)
        await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})

        // Each plan §2 panel gates its <h2> behind `{data && (...)}`. When the
        // dev/CI environment can't reach backend.gnolove.world (CORS blocks
        // localhost:5173 in production; Phase 5.5 CORS-glob work was dropped),
        // no panels mount. Soft-skip in that case rather than failing — the
        // canary's job is to surface frontend regressions, not to alarm on
        // every backend hiccup or environment without CORS access.
        const renderedPanels = await page.locator(".gl-panel-title").count()
        test.skip(
            renderedPanels === 0,
            "No analytics panels rendered — backend data unavailable (CORS or backend down). Run against memba.samourai.app for full coverage.",
        )

        // Panel titles from plan §2.
        const titles = [
            /PR Cycle Time/i,
            /Topic activity/i,
            /Repo health/i,
            /Contributor cohort retention/i,
            /Cross-team collaboration/i,
        ]
        for (const re of titles) {
            await expect(page.locator(".gl-panel-title", { hasText: re })).toBeVisible({ timeout: 10_000 })
        }
    })

    test("on-chain metrics tile is removed per plan §2", async ({ page }) => {
        await page.goto(ANALYTICS_PATH)
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

        // The duplicate "On-Chain Metrics" panel was deleted in v6.2.2.
        // Detecting its return is the cheapest way to keep the cleanup
        // honest — DashStatCard stays at the top of the page so the
        // data isn't lost.
        await expect(page.locator(".gl-panel-title", { hasText: /On-Chain Metrics/i })).toHaveCount(0)
    })
})

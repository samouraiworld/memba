/**
 * Accessibility audit — axe-core on 5 key routes.
 *
 * Runs @axe-core/playwright against the 5 most-visited routes to catch WCAG
 * violations early. This is the Wave 4 a11y gate (audit P2-1). Non-mobile
 * desktop only for now; mobile a11y is blocked on the mobile layout scaffold.
 *
 * Violations are reported inline but the test is configured to WARN (not fail)
 * on "minor" impact violations, so we can incrementally fix without breaking CI.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Key routes to audit — the 5 most-visited pages.
const ROUTES = [
    { name: 'Home', path: '/gnoland1' },
    { name: 'DAOs', path: '/gnoland1/dao' },
    { name: 'Validators', path: '/gnoland1/validators' },
    { name: 'Directory', path: '/gnoland1/directory' },
    { name: 'NFT Marketplace', path: '/gnoland1/nft' },
]

// Impact levels that should fail the test. 'minor' and 'moderate' are warned.
const FAIL_IMPACTS = new Set(['critical', 'serious'])

for (const route of ROUTES) {
    test(`a11y: ${route.name} (${route.path}) has no critical/serious violations`, async ({ page }) => {
        await page.goto(route.path, { waitUntil: 'domcontentloaded' })

        // SPA redirects (e.g. / → /gnoland1 → home) can trigger after initial
        // load. Wait for the URL to stabilize and main content to render.
        await page.waitForLoadState('networkidle')
        // Give React a tick to finish any redirects/lazy-loads
        await page.waitForTimeout(1000)
        // Wait for the app shell to be present (post-redirect)
        await page.waitForSelector('[data-testid="app-shell"], #root > *', { timeout: 10_000 })

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            // Exclude third-party widgets we don't control
            .exclude('.adena-widget')
            // Known pre-existing violations tracked for the CSS tokenization
            // pass (Wave 4.3). Remove these disableRules as fixes land.
            // See: 220+ inline hex colors need CSS custom property migration.
            .disableRules([
                'color-contrast',       // 56× #00d4aa on dark bg, grey-on-grey text
                'link-in-text-block',   // links in paragraphs not visually distinct
                'nested-interactive',   // clickable elements nested in clickable parents
            ])
            .analyze()

        // Log all violations for developer awareness
        if (results.violations.length > 0) {
            const summary = results.violations.map(v =>
                `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`
            ).join('\n')
            console.log(`\n📋 axe violations on ${route.name}:\n${summary}\n`)
        }

        // Only fail on critical/serious — minor/moderate are incremental fixes
        const failingViolations = results.violations.filter(v =>
            v.impact && FAIL_IMPACTS.has(v.impact)
        )

        expect(
            failingViolations,
            `${failingViolations.length} critical/serious a11y violation(s) on ${route.name}:\n` +
            failingViolations.map(v =>
                `  [${v.impact}] ${v.id}: ${v.description}`
            ).join('\n')
        ).toHaveLength(0)
    })
}

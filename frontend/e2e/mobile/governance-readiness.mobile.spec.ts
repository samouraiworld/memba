import { test, expect, type Page } from '@playwright/test'
import { findHorizontalClipping } from '../helpers/overflow'

/**
 * Layout contract for the governance-readiness panel on the validators Network
 * tab.
 *
 * The panel only renders once roster data loads, which the dead-chain / stubbed
 * e2e environments never do, so these tests inject its markup and measure the
 * real stylesheet. Two traps are handled explicitly:
 *  - The panel's CSS arrives with the lazy validators chunk, AFTER <main>
 *    exists. Measuring before it loads passes vacuously, so every test first
 *    waits for a sentinel rule from GovernanceReadinessPanel.css.
 *  - The what-if sentence is long and unbreakable in places; it must wrap, not
 *    widen the panel past the screen.
 */

async function waitForPanelSheet(page: Page) {
    await page.waitForFunction(() => {
        const el = document.createElement('div')
        el.className = 'gov-ready'
        el.style.position = 'absolute'
        el.style.visibility = 'hidden'
        document.body.appendChild(el)
        const ok = getComputedStyle(el).borderTopLeftRadius === '10px'
        el.remove()
        return ok
    }, null, { timeout: 30_000 })
}

const PANEL = `
<section class="gov-ready" aria-labelledby="gr-t">
  <h2 id="gr-t" class="gov-ready__title">Governance readiness</h2>
  <p class="gov-ready__lede">Who can change the validator set, and how much failure the network can absorb right now.</p>
  <div class="gov-ready__grid">
    <div class="gov-ready__block">
      <h3 class="gov-ready__h">Who can act</h3>
      <p class="gov-ready__stat">1 GovDAO member</p>
      <ul class="gov-ready__tiers"><li class="gov-ready__tier">T1: 1 (power 3)</li><li class="gov-ready__tier">T2: 0 (power 0)</li><li class="gov-ready__tier">T3: 0 (power 0)</li></ul>
      <p class="gov-ready__text">Adding or removing a validator requires a GovDAO proposal, and only GovDAO members can create one.</p>
    </div>
    <div class="gov-ready__block">
      <h3 class="gov-ready__h">Failure tolerance</h3>
      <dl class="gov-ready__stats"><dt>Active validators</dt><dd>4</dd><dt>Voting power needed to commit a block</dt><dd>161 of 240</dd><dt>Can go offline without halting</dt><dd>1 validator</dd></dl>
      <p class="gov-ready__whatif gov-ready__whatif--danger">If the largest validator went offline or were removed: 3 validators, quorum 121 of 180, able to lose 0 more validators without halting. Any single remaining validator could then halt consensus — and a halted chain cannot pass the proposal that would fix it.</p>
    </div>
  </div>
</section>`

async function mountPanel(page: Page, width: number) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/validators')
    await waitForPanelSheet(page)
    // A live stylesheet does not mean the route has rendered <main> yet (WebKit).
    await page.locator('main').waitFor({ state: 'attached' })
    await page.evaluate((html) => {
        const host = document.createElement('div')
        host.dataset.testid = 'gov-ready-probe'
        host.innerHTML = html
        document.querySelector('main')!.appendChild(host)
    }, PANEL)
}

const gridTracks = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="gov-ready-probe"] .gov-ready__grid')!).gridTemplateColumns.trim())

test('the panel stacks into one column on a phone and hides nothing', async ({ page }) => {
    await mountPanel(page, 375)
    const tracks = await gridTracks(page)
    expect(tracks, 'panel grid must be styled before it is measured').not.toBe('none')
    expect(tracks.split(/\s+/).length, `panel columns at 375px (got "${tracks}")`).toBe(1)
    // Scoped to the injected panel. Page-wide, WebKit's first attempt flagged a
    // classless `DIV sw=228 cw=200` that is not in the panel's markup (every
    // panel element carries a class) — the still-loading page around the probe.
    // Whole-route clipping is validators.mobile.spec.ts's contract, not this one.
    expect(await findHorizontalClipping(page, '[data-testid="gov-ready-probe"]'), 'panel clips content at 375px').toEqual([])
    const overflow = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="gov-ready-probe"] .gov-ready') as HTMLElement
        return p.scrollWidth - p.clientWidth
    })
    expect(overflow, 'the long what-if sentence must wrap, not widen the panel').toBeLessThanOrEqual(1)
})

test('the panel keeps its two columns on desktop', async ({ page }) => {
    await mountPanel(page, 1280)
    const tracks = await gridTracks(page)
    expect(tracks.split(/\s+/).length, `panel columns at 1280px (got "${tracks}")`).toBe(2)
})

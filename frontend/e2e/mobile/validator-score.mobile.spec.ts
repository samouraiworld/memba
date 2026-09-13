import { test, expect, type Page } from '@playwright/test'
import { findHorizontalClipping } from '../helpers/overflow'

/**
 * Layout contract for the reliability score card on a validator's profile.
 *
 * The card renders only after gnomonitoring answers, which the offline e2e
 * environment never does, so these tests inject its markup and measure it with
 * the real stylesheet. validator-detail.css arrives with the lazy profile chunk
 * AFTER <main> exists; every test waits for a sentinel rule from that sheet
 * first — measuring earlier passes vacuously (validators.mobile.spec.ts has the
 * full story).
 *
 * The markup is the component's worst case for width: "Excellent" (the longest
 * tier) on every tab, and the longest driver values the formatter produces.
 */

async function onProfile(page: Page, width: number) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/validators/g1scoreprobe')
    // validator-detail.css: `.vd-page { max-width: 900px }` is unconditional.
    await page.waitForFunction(() => {
        const el = document.createElement('div')
        el.className = 'vd-page'
        el.style.position = 'absolute'
        el.style.visibility = 'hidden'
        document.body.appendChild(el)
        const ok = getComputedStyle(el).maxWidth === '900px'
        el.remove()
        return ok
    }, null, { timeout: 30_000 })
}

const TAB = (label: string) =>
    `<button type="button" role="tab" class="vd-score-tab vd-score-tab--ok" aria-selected="${label === '24h'}">`
    + `<span class="vd-score-tab__label">${label}</span><span class="vd-score-tab__score">100</span>`
    + '<span class="vd-score-tab__tier">Excellent</span></button>'

const DRIVER = (dt: string, dd: string) => `<div class="vd-score-driver"><dt>${dt}</dt><dd>${dd}</dd></div>`

const CARD = `
<section class="vd-card vd-score" data-testid="score-probe">
  <div class="vd-card__title"><span aria-hidden="true">🎯 </span>Reliability score</div>
  <p class="vd-score__intro">Scored 0–100 by gnomonitoring: the sign rate, minus penalties for alerts, downtime and how often incidents happen — so the same incidents weigh more in a shorter window. Excellent 85+ · Good 60+ · Watch 30+ · Critical below 30.</p>
  <p class="vd-score__meta">Last alert 12 days ago</p>
  <div class="vd-score-tabs" role="tablist">${['24h', 'Week', 'Month', 'Year'].map(TAB).join('')}</div>
  <div class="vd-score-panel" role="tabpanel">
    <p class="vd-score-panel__window">This month · since the 1st, UTC</p>
    <dl class="vd-score-drivers">
      ${DRIVER('Sign rate', '98.6%')}
      ${DRIVER('Missed blocks', '12,345')}
      ${DRIVER('Downtime', '12,345 blocks')}
      ${DRIVER('Incidents', '1,234 · 189/week')}
      ${DRIVER('Alerts', '12 critical · 127 warnings')}
      ${DRIVER('Proposals', '98.2% of expected')}
    </dl>
  </div>
</section>`

async function mountCard(page: Page, width: number) {
    await onProfile(page, width)
    await page.evaluate((html) => {
        const host = document.createElement('div')
        host.innerHTML = html
        ;(document.querySelector('.vd-page') ?? document.querySelector('main')!).appendChild(host)
    }, CARD)
}

const measure = (page: Page) => page.evaluate(() => {
    const root = document.querySelector('[data-testid="score-probe"]')!
    const tabs = root.querySelector('.vd-score-tabs')!
    const drivers = root.querySelector('.vd-score-drivers')!
    const tracks = (el: Element) => getComputedStyle(el).gridTemplateColumns.trim()
    // A span's box is sized by its tab, so its RECT never shows overflowing
    // text; scrollWidth does.
    const overflowing = Array.from(root.querySelectorAll('.vd-score-tab, .vd-score-tab > span, .vd-score-driver, .vd-score-driver > *'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.className || el.tagName}: "${el.textContent}" ${el.scrollWidth}>${el.clientWidth}`)
    const tabRects = Array.from(tabs.children).map((t) => t.getBoundingClientRect())
    return {
        tabTracks: tracks(tabs),
        driverTracks: tracks(drivers),
        overflowing,
        minTabHeight: Math.min(...tabRects.map((r) => r.height)),
        cardRight: root.getBoundingClientRect().right,
        viewport: document.documentElement.clientWidth,
    }
})

for (const width of [320, 375, 430]) {
    test(`score tabs and their breakdown fit a ${width}px screen`, async ({ page }) => {
        await mountCard(page, width)
        const m = await measure(page)
        expect(m.tabTracks, 'score tabs must be a styled grid before they are measured').not.toBe('none')
        expect(m.tabTracks.split(/\s+/).length, `window tabs at ${width}px (got "${m.tabTracks}")`).toBe(4)
        expect(m.driverTracks.split(/\s+/).length, `breakdown columns at ${width}px (got "${m.driverTracks}")`).toBe(2)
        expect(m.overflowing, 'score text overflowing its box').toEqual([])
        expect(m.minTabHeight, 'window tabs are thumb-sized').toBeGreaterThanOrEqual(44)
        expect(m.cardRight, 'card stays on screen').toBeLessThanOrEqual(m.viewport)
        expect(await findHorizontalClipping(page), `profile clips content at ${width}px`).toEqual([])
    })
}

test('on a desktop the breakdown spreads to three columns', async ({ page }) => {
    await mountCard(page, 1280)
    const m = await measure(page)
    expect(m.tabTracks.split(/\s+/).length).toBe(4)
    expect(m.driverTracks.split(/\s+/).length, `breakdown columns at 1280px (got "${m.driverTracks}")`).toBe(3)
    expect(m.overflowing).toEqual([])
})

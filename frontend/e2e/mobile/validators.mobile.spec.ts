import { test, expect, type Page } from '@playwright/test'
import { findHorizontalClipping, MOBILE_375 } from '../helpers/overflow'

/**
 * Mobile layout contracts for the validators surface.
 *
 * ⚠️ READ THIS BEFORE ADDING A TEST — THE STYLESHEET RACE.
 *
 * Each validators route is a lazy chunk, and Vite injects that chunk's CSS when
 * the chunk loads — which is AFTER `<main>` exists. Waiting for `main` (or even
 * for a route element to be attached) therefore races the stylesheet. Measured
 * on a cold load at 375px: an injected `.val-page` reported `padding: 0px` and a
 * `.val-health-down` reported `animation-name: none`; the same probes on a warm
 * load reported `24px 32px 40px` and `val-health-pulse`.
 *
 * Losing that race is silent, and it cuts both ways: an unstyled probe passes
 * any "at most N px" assertion vacuously, and fails a structural one for the
 * wrong reason (an unstyled div reports `grid-template-columns: none`, which
 * splits into ONE "track"). So every test here first waits for a SENTINEL — an
 * unconditional rule from the exact stylesheet it measures — to be computed.
 * Sentinels are base rules this suite never changes, so a fix cannot move them.
 */

/** Resolves once `cls` computes `prop` to `expected` — i.e. its sheet is live. */
async function waitForSheet(page: Page, cls: string, prop: string, expected: string) {
    await page.waitForFunction(({ cls, prop, expected }) => {
        const el = document.createElement('div')
        el.className = cls
        el.style.position = 'absolute'
        el.style.visibility = 'hidden'
        document.body.appendChild(el)
        const ok = getComputedStyle(el).getPropertyValue(prop) === expected
        el.remove()
        return ok
    }, { cls, prop, expected }, { timeout: 30_000 })
}

/** validators.css: `.val-page { max-width: 1920px }` is unconditional. */
const rosterSheet = (page: Page) => waitForSheet(page, 'val-page', 'max-width', '1920px')
/** hacker-mode.css: `.hk-layout { display: grid }` is unconditional. */
const hackerModeSheet = (page: Page) => waitForSheet(page, 'hk-layout', 'display', 'grid')
/** validators-hacker.css: `.hk-status-bar { border-radius: 5px }` is unconditional. */
const hackerPageSheet = (page: Page) => waitForSheet(page, 'hk-status-bar', 'border-top-left-radius', '5px')

async function onRoster(page: Page, width = MOBILE_375.width) {
    await page.setViewportSize({ width, height: MOBILE_375.height })
    await page.goto('/validators')
    await rosterSheet(page)
}

async function onHacker(page: Page, width = MOBILE_375.width) {
    await page.setViewportSize({ width, height: MOBILE_375.height })
    await page.goto('/validators/hacker')
    await page.locator('.hk-layout').waitFor({ state: 'attached' })
    await hackerModeSheet(page)
    await hackerPageSheet(page)
}

/** Inject markup into <main> and measure it with the page's real styles. */
async function probe<T>(page: Page, html: string, measure: (root: HTMLElement) => T): Promise<T> {
    return page.evaluate(({ html, fn }) => {
        const host = document.createElement('div')
        host.dataset.testid = 'css-contract-probe'
        host.innerHTML = html
        document.querySelector('main')!.appendChild(host)
        return new Function('root', `return (${fn})(root)`)(host)
    }, { html, fn: measure.toString() })
}

// ── Containment (hacker telemetry grid) ────────────────────────────────────
//
// On prod at 390px `.hk-layout` resolved its single track to 674.57px inside a
// 324px box; `.k-main-column { overflow-x: hidden }` destroyed the excess. Bare
// `1fr` is `minmax(auto, 1fr)`, and `auto` floors the track at the widest
// child's min-content. Fixed with `minmax(0, 1fr)` (#1168).

for (const route of ['/validators', '/validators/hacker'] as const) {
    test(`${route} hides no content at 375px`, async ({ page }) => {
        if (route === '/validators') await onRoster(page)
        else await onHacker(page)
        const clipped = await findHorizontalClipping(page)
        expect(clipped, `${route} clips content horizontally at 375px`).toEqual([])
    })
}

test('the telemetry grid track stays inside its container, whatever the content', async ({ page }) => {
    await onHacker(page)
    const layout = page.locator('.hk-layout')
    await layout.evaluate((el) => {
        const probeEl = document.createElement('div')
        probeEl.dataset.testid = 'containment-probe'
        probeEl.style.cssText = 'width:900px;height:4px'
        el.appendChild(probeEl)
    })
    const { tracks, trackWidth, layoutClientWidth } = await layout.evaluate((el) => {
        const gtc = getComputedStyle(el).gridTemplateColumns
        return { tracks: gtc, trackWidth: Math.round(parseFloat(gtc)), layoutClientWidth: el.clientWidth }
    })
    // Guard the measurement itself: `none` would mean the sheet never applied,
    // and parseFloat('none') is NaN — which used to coerce to 0 and pass.
    expect(tracks, 'hk-layout must be a styled grid before its track is measured').not.toBe('none')
    expect(Number.isFinite(trackWidth)).toBe(true)
    // Scope: this asserts the TRACK only. Constraining the track does not make an
    // unshrinkable child fit — it moves that overflow to the child, which must
    // provide its own scroller (as .hk-peers__table-wrap does).
    expect(trackWidth, 'grid track must be sized by its container, not its widest child')
        .toBeLessThanOrEqual(layoutClientWidth)
})

test('every telemetry card fits the column it is placed in', async ({ page }) => {
    await onHacker(page)
    const cards = page.locator('.hk-layout > .hk-card')
    await expect(cards.first()).toBeAttached()
    expect(await cards.count(), 'telemetry cards must render before containment is measured').toBeGreaterThan(0)
    const oversized = await page.evaluate(() => {
        const layout = document.querySelector('.hk-layout')!
        const track = layout.clientWidth
        return Array.from(layout.children)
            .filter((c) => c.getBoundingClientRect().width > track + 1)
            .map((c) => `${(c.className || '').toString().trim()} w=${Math.round(c.getBoundingClientRect().width)} track=${track}`)
    })
    expect(oversized, 'card(s) wider than their grid column').toEqual([])
})

// ── Roster density ─────────────────────────────────────────────────────────

test('stat cards sit two-up on a phone instead of stacking five tall', async ({ page }) => {
    // The 1.52-screen scroll before the first validator came from a 480px
    // override resetting this grid to ONE column, undoing the 2-up rule above it.
    await onRoster(page)
    const tracks = await probe(page,
        '<div class="val-stats-grid">' + '<div class="val-stat-card">x</div>'.repeat(5) + '</div>',
        (root) => getComputedStyle(root.querySelector('.val-stats-grid')!).gridTemplateColumns.trim())
    expect(tracks, 'stats grid must be a styled grid').not.toBe('none')
    expect(tracks.split(/\s+/).length, `stats grid columns at 375px (got "${tracks}")`).toBe(2)
})

test('page padding stops spending a sixth of a 375px screen on gutters', async ({ page }) => {
    await onRoster(page)
    const padX = await probe(page, '<div class="val-page">x</div>',
        (root) => { const cs = getComputedStyle(root.querySelector('.val-page')!); return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) })
    expect(padX, 'combined horizontal padding at 375px').toBeLessThanOrEqual(24)
})

test('the three section tabs fit the screen and are thumb-sized', async ({ page }) => {
    await onRoster(page)
    const r = await probe(page,
        '<div class="val-segtabs" role="tablist">'
        + '<button class="val-segtab val-segtab--active">Validators<span class="val-segtab__count">4</span></button>'
        + '<button class="val-segtab">Candidates<span class="val-segtab__count">12</span></button>'
        + '<button class="val-segtab">Network<span class="val-segtab__count">13</span></button>'
        + '</div>',
        (root) => {
            const bar = root.querySelector('.val-segtabs') as HTMLElement
            return {
                overflow: bar.scrollWidth - bar.clientWidth,
                minHeight: Math.min(...Array.from(bar.querySelectorAll('.val-segtab')).map((t) => t.getBoundingClientRect().height)),
            }
        })
    expect(r.overflow, 'tab strip must not clip its last tab').toBeLessThanOrEqual(1)
    expect(r.minHeight, 'tab touch target').toBeGreaterThanOrEqual(44)
})

test('roster controls meet the 44px touch floor', async ({ page }) => {
    await onRoster(page)
    const heights = await probe(page,
        '<input class="val-search" type="text"><select class="val-page-size"><option>Sort</option></select><button class="val-page-btn">Next</button>',
        (root) => Array.from(root.children).map((el) => [el.className, Math.round(el.getBoundingClientRect().height)] as const))
    for (const [cls, h] of heights) expect(h, `${cls} height`).toBeGreaterThanOrEqual(44)
})

// iOS zooms any focused control below 16px. index.css guards `input[type=text]`
// and `select` only up to 428px — and a bare `select` (0,0,1) cannot beat
// `.val-page-size` (0,1,0) even there. 430px is iPhone Pro Max width.
for (const width of [375, 430] as const) {
    test(`focusing search or sort does not make iOS zoom the page at ${width}px`, async ({ page }) => {
        await onRoster(page, width)
        const sizes = await probe(page,
            '<input class="val-search" type="text"><select class="val-page-size"><option>Sort</option></select>',
            (root) => Array.from(root.children).map((el) => [el.className, parseFloat(getComputedStyle(el).fontSize)] as const))
        for (const [cls, px] of sizes) expect(px, `${cls} font-size at ${width}px`).toBeGreaterThanOrEqual(16)
    })
}

// ── Reduced motion (regression pin, not a fix) ─────────────────────────────
//
// An audit reported these badges pulse forever with no off switch because the
// validators stylesheets contain no prefers-reduced-motion rule. True of the
// files, false of the page: index.css carries a global reset that forces
// `animation-iteration-count: 1 !important` under `reduce`. These two tests pin
// that behaviour so a change to the global reset cannot silently bring the
// infinite pulses back.
const MOTION_PROBE = '<span class="val-refreshing">x</span><div class="val-spinner"></div>'
    + '<span class="val-health-dot val-health-dot--down"></span><span class="val-health-down">x</span>'
    + '<span class="val-missed-critical">x</span>'
const iterationCounts = (root: HTMLElement) =>
    Array.from(root.children).map((el) => [el.className, getComputedStyle(el).animationIterationCount] as const)

test('reduced-motion users get no infinitely repeating animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await onRoster(page)
    for (const [cls, count] of await probe(page, MOTION_PROBE, iterationCounts)) {
        expect(count, `${cls} under prefers-reduced-motion`).not.toBe('infinite')
    }
})

test('the pulses are real for users who have not asked to reduce motion', async ({ page }) => {
    // Negative control: without this, the test above could pass merely because
    // none of these classes animate at all.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await onRoster(page)
    const down = (await probe(page, MOTION_PROBE, iterationCounts)).find(([c]) => c === 'val-health-down')!
    expect(down[1]).toBe('infinite')
})

// ── Hacker page chrome ─────────────────────────────────────────────────────

test('telemetry status bar wraps instead of clipping its freshness readout', async ({ page }) => {
    await onHacker(page)
    const r = await probe(page,
        '<div class="hk-status-bar"><span>Block 4,440</span><span>synced</span><span>Peers 13</span>'
        + '<span>connected</span><span>monitoring</span><span class="hk-status-bar__updated">Updated 21:07:18 (2s)</span></div>',
        (root) => { const b = root.querySelector('.hk-status-bar') as HTMLElement; return { wrap: getComputedStyle(b).flexWrap, overflow: b.scrollWidth - b.clientWidth } })
    expect(r.wrap).toBe('wrap')
    expect(r.overflow, 'status bar must not clip').toBeLessThanOrEqual(1)
})

test('copy affordance on seed and app-hash rows is visible without a mouse', async ({ page }) => {
    // It was opacity:0 until :hover — permanently invisible on a touch screen.
    await onHacker(page)
    const opacity = await probe(page, '<div class="cs-row"><span class="cs-row__copy">copy</span></div>',
        (root) => parseFloat(getComputedStyle(root.querySelector('.cs-row__copy')!).opacity))
    expect(opacity).toBeGreaterThan(0.5)
})

// ── Mobile rules must stay mobile ──────────────────────────────────────────
//
// Every density fix above lives in a max-width media query EXCEPT the status
// bar's flex-wrap, which is a base rule. These pin that none of it leaks onto a
// desktop layout that was already correct.

test('desktop keeps 4-up stats, full gutters and a flex tab strip', async ({ page }) => {
    await onRoster(page, 1280)
    const r = await probe(page,
        '<div class="val-page"><div class="val-stats-grid">' + '<div class="val-stat-card">x</div>'.repeat(4) + '</div>'
        + '<div class="val-segtabs"><button class="val-segtab">Validators</button><button class="val-segtab">Network</button></div></div>',
        (root) => {
            const page = getComputedStyle(root.querySelector('.val-page')!)
            return {
                tracks: getComputedStyle(root.querySelector('.val-stats-grid')!).gridTemplateColumns.trim().split(/\s+/).length,
                padX: parseFloat(page.paddingLeft) + parseFloat(page.paddingRight),
                tabsDisplay: getComputedStyle(root.querySelector('.val-segtabs')!).display,
            }
        })
    expect(r.tracks, 'stats columns at 1280px').toBe(4)
    expect(r.padX, 'desktop gutters unchanged').toBe(64)
    expect(r.tabsDisplay, 'desktop tab strip stays flex').toBe('flex')
})

test('desktop status bar still fits on a single line despite being allowed to wrap', async ({ page }) => {
    await onHacker(page, 1280)
    const lines = await probe(page,
        '<div class="hk-status-bar"><span>Block 4,440</span><span>synced</span><span>Peers 13</span>'
        + '<span>connected</span><span>monitoring</span><span class="hk-status-bar__updated">Updated 21:07:18 (2s)</span></div>',
        (root) => {
            // Count rows by OVERLAP, not by distinct `top` values. The children are
            // vertically centred but not all the same height (the "Updated" span is
            // 0.65rem against 0.7rem), so on ONE line their tops differ by a
            // fraction of a pixel — measured 1502.03 vs 1502.67 — and rounding
            // split that single line into "2 rows". A child starts a new row only
            // if it begins below the bottom of the row before it.
            const boxes = Array.from(root.querySelector('.hk-status-bar')!.children)
                .map((c) => c.getBoundingClientRect())
                .filter((b) => b.width > 0)
                .sort((a, b) => a.top - b.top)
            let rows = 0
            let rowBottom = -Infinity
            for (const b of boxes) {
                if (b.top >= rowBottom - 1) { rows++; rowBottom = b.bottom } else rowBottom = Math.max(rowBottom, b.bottom)
            }
            return rows
        })
    expect(lines, 'status bar rows at 1280px').toBe(1)
})

import { expect, test, type Page } from '@playwright/test'
import { settle } from './settle'
import { OS_ON } from '../../playwright.os.config'
import { abortOnchainReads } from '../helpers/onchain'

// Classic pages inside Memba OS windows wear the Aqua tokens instead of the Beta
// teal palette. Chain reads and third-party hosts are refused so the probes are
// deterministic (same pattern as os-pages.spec.ts).
async function guest(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await abortOnchainReads(page)
}


for (const theme of ['light', 'dark'] as const) {
    test(`classic pages take the Aqua tokens (${theme})`, async ({ page }) => {
        await guest(page)
        await page.emulateMedia({ colorScheme: theme })
        await page.addInitScript(() => {
            localStorage.setItem('memba_os_seen', '1')
            localStorage.setItem('memba_os_booted', '1')
        })
        // /os/extensions (a plausible-looking probe path) isn't a valid OS deep
        // link — osPath.ts requires the first segment to be an app slug ("store"),
        // so it opened the "Not found" window instead of a classic page. The App
        // Store app's "extensions" route is reached at /os/store/extensions.
        await page.goto(`${OS_ON}/os/store/extensions`)
        const probe = await page.locator('.os-classic').first().evaluate((host) => {
            const os = getComputedStyle(host.closest('.memba-os')!)
            const cls = getComputedStyle(host)
            const mk = (cn: string) => { const el = document.createElement('button'); el.className = cn; el.textContent = 'x'; host.appendChild(el); const s = getComputedStyle(el); const r = { bg: s.backgroundColor, fg: s.color, font: s.fontFamily }; el.remove(); return r }
            const swatch = (v: string) => { const el = document.createElement('i'); el.style.color = `var(${v})`; host.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c }
            return {
                primary: mk('k-btn-primary'),
                acc: swatch('--os-acc'), ink: swatch('--os-ink'),
                text: swatch('--color-text'), kAccent: swatch('--color-k-accent'), brand: swatch('--color-brand'),
                htmlTheme: document.documentElement.getAttribute('data-theme'), osTheme: host.closest('.memba-os')!.getAttribute('data-os-theme'),
                font: cls.fontFamily, osFont: os.fontFamily,
            }
        })
        expect(probe.htmlTheme).toBe(probe.osTheme)
        expect(probe.primary.bg).toBe(probe.acc)
        expect(probe.kAccent).toBe(probe.acc)
        expect(probe.brand).toBe(probe.acc)
        expect(probe.text).toBe(probe.ink)
        expect(probe.font).toContain('Manrope')
        await page.evaluate(() => document.fonts.ready)
        expect(await page.evaluate(async () => (await document.fonts.load('700 13px Manrope')).some((f) => f.status === 'loaded'))).toBe(true)
    })
}

// Tokens renders a native unavailable state on mainnet, so it has no classic
// subtree to check. The sweep still covers every app listed here.
const APPS = ['feed', 'store', 'settings', 'quests', 'validators', 'profile', 'news', 'explorer', 'feedback', 'dev-report']

test('Tokens unavailable state is native on mainnet', async ({ page }) => {
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    await page.goto(`${OS_ON}/os/tokens`)
    const tokens = page.getByRole('region', { name: 'Tokens', exact: true })
    await expect(tokens.getByRole('note')).toContainText('factory is not deployed')
    await expect(tokens.locator('.os-classic')).toHaveCount(0)
})

// Apps whose classic page is wallet-gated (classicRoute.ts pageNeedsWallet): as a
// guest they render a "Connect a wallet to use <App>." holding pane, never
// .os-classic — that's the only reason .os-classic is allowed to be absent. Any
// other app that never renders it is a real bug (a broken route, an error
// boundary, a regression), not a state to shrug off.
const WALLET_GATED = ['profile']

/** Every exact Beta-teal RGB triple the app's CSS still carries a literal of,
 * across light and dark theme, that classic-bridge.css needs to bridge instead. */
const TEAL_RGB = '(?:0, ?212, ?170|0, ?168, ?138|0, ?230, ?187|0, ?148, ?120|15, ?110, ?86|45, ?212, ?191)'

async function sweepTealFor(page: Page, app: string, hits: string[]) {
    await page.goto(`${OS_ON}/os/${app}`)
    const classic = page.locator('.os-classic').first()
    try {
        await classic.waitFor({ timeout: 20_000 })
    } catch {
        if (!WALLET_GATED.includes(app)) throw new Error(`${app}: no .os-classic`)
        test.info().annotations.push({ type: 'skipped', description: `${app}: wallet-gated for a guest, no .os-classic to sweep` })
        return
    }
    await settle(classic)
    hits.push(...await classic.evaluate((root, args) => {
        const teal = new RegExp(`rgba?\\(${args.rgb}`)
        const shadowOrGradient = new RegExp(args.rgb)
        const out: string[] = []
        for (const el of root.querySelectorAll('*')) {
            const s = getComputedStyle(el)
            for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor', 'fill', 'stroke'] as const) {
                if (teal.test(s[p])) out.push(`${args.app}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${p}`)
            }
            if (shadowOrGradient.test(s.boxShadow + s.backgroundImage)) out.push(`${args.app}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} shadow/gradient`)
        }
        return out
    }, { app, rgb: TEAL_RGB }))
}

test('no Beta teal inside the app windows', async ({ page }) => {
    // Each app can spend up to 20s waiting for its page and another 20s
    // waiting for all visible loading states, beyond the default test budget;
    // this doesn't fire on the normal fast path, only when a wait actually
    // needs the extra headroom.
    test.setTimeout(APPS.length * 40_000 + 30_000)
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    const hits: string[] = []
    for (const app of APPS) await sweepTealFor(page, app, hits)
    expect(hits).toEqual([])
})

// The main sweep above only runs a guest, light-theme pass (real per-validator
// data and dark-theme literals are out of its reach as a guest). This pass adds
// dark-theme coverage for the two apps most likely to carry a theme-specific
// literal (chart/heatmap tokens, validator status colours).
test('no Beta teal inside the app windows (dark: validators, dev-report)', async ({ page }) => {
    test.setTimeout(2 * 40_000 + 30_000)
    await guest(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    const hits: string[] = []
    for (const app of ['validators', 'dev-report']) await sweepTealFor(page, app, hits)
    expect(hits).toEqual([])
})

test('a checkbox inside a classic window keeps a visible focus ring', async ({ page }) => {
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    await page.goto(`${OS_ON}/os/settings`)
    await page.locator('.os-classic').first().waitFor()
    // Settings/App Store's own checkboxes are behind live data or a feature flag
    // this guest fixture doesn't reach, so mount a bare one inside the live
    // .os-classic scope instead — a real element, styled by the real CSS, just not
    // one of the app's own gated checkboxes.
    await page.evaluate(() => {
        const classic = document.querySelector('.os-classic')!
        const wrap = document.createElement('div')
        wrap.innerHTML = '<button id="focus-probe-anchor" type="button">anchor</button><input id="focus-probe-checkbox" type="checkbox">'
        classic.prepend(wrap)
    })
    await page.locator('#focus-probe-anchor').click()
    await page.keyboard.press('Tab')
    await expect(page.locator('#focus-probe-checkbox')).toBeFocused()
    const outlineStyle = await page.locator('#focus-probe-checkbox').evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outlineStyle).not.toBe('none')
})

test('the route-fallback loader inside a window hides its logo and stays compact', async ({ page }) => {
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    await page.goto(`${OS_ON}/os/settings`)
    await page.locator('.os-classic').first().waitFor()
    // ConnectingLoader's own route chunk loads too fast in this fixture for a delayed-
    // chunk probe to be deterministic, so this mounts its exact markup shape (role=
    // status/aria-live=polite wrapping the .animate-glow logo and the track) directly
    // inside the live .os-classic scope, the same way the checkbox and kit-nav probes
    // above do for shapes this fixture can't otherwise reach live.
    const result = await page.evaluate(() => {
        const classic = document.querySelector('.os-classic')!
        const host = document.createElement('div')
        host.innerHTML = '<div role="status" aria-live="polite" style="min-height:30vh"><div class="animate-glow" style="width:104px;height:104px;display:flex;align-items:center;justify-content:center"><img></div><div style="width:200px;height:2px;background:rgba(255,255,255,0.04)"><div></div></div><span>Loading...</span></div>'
        classic.appendChild(host)
        const wrap = host.querySelector('[role="status"]') as HTMLElement
        const logo = host.querySelector('.animate-glow') as HTMLElement
        const out = { minHeight: parseFloat(getComputedStyle(wrap).minHeight), logoDisplay: getComputedStyle(logo).display }
        host.remove()
        return out
    })
    expect(result.minHeight).toBeLessThanOrEqual(160)
    expect(result.logoDisplay).toBe('none')
})

test('kit.css scopes the sidebar nav to a direct child, not a classic <nav> in the section', async ({ page }) => {
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    // Mount both navigation shapes in the live theme to check that sidebar
    // styling reaches only the direct child, even when a section contains nav.
    await page.goto(`${OS_ON}/os/settings`)
    await page.locator('.os-classic').first().waitFor()
    const result = await page.evaluate(() => {
        const host = document.createElement('div')
        document.querySelector('.memba-os')!.appendChild(host)
        host.innerHTML = '<div class="os-fw"><nav><button>Kit</button></nav><section><nav><button>Classic</button></nav></section></div>'
        const [kitBtn, classicBtn] = [...host.querySelectorAll('nav button')] as HTMLElement[]
        const out = { kit: getComputedStyle(kitBtn).padding, classic: getComputedStyle(classicBtn).padding }
        host.remove()
        return out
    })
    expect(result.kit).toBe('7px 10px')
    expect(result.classic).not.toBe('7px 10px')
})

for (const view of [
    { name: 'light', theme: 'light', width: 1400, height: 900 },
    { name: 'dark', theme: 'dark', width: 1400, height: 900 },
    { name: '420px', theme: 'light', width: 1400, height: 900, windowWidth: 420 },
    { name: 'phone', theme: 'light', width: 375, height: 760 },
] as const) {
    test(`classic Settings layout and font · ${view.name}`, async ({ page }, testInfo) => {
        await guest(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.emulateMedia({ colorScheme: view.theme, reducedMotion: 'reduce' })
        await page.setViewportSize({ width: view.width, height: view.height })
        await page.goto(`${OS_ON}/os/settings`)
        const settings = page.getByRole('region', { name: 'Settings', exact: true })
        const classic = settings.locator('.os-classic')
        await expect(classic).toBeVisible({ timeout: 30_000 })
        await settle(classic)
        if ('windowWidth' in view) {
            await settings.evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px` }, view.windowWidth)
        }
        await page.evaluate(() => document.fonts.ready)
        expect(await classic.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Manrope')
        expect(await classic.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        const screenshot = testInfo.outputPath(`foundations-${view.name}.png`)
        await page.screenshot({ path: screenshot })
        await testInfo.attach(`foundations-${view.name}`, { path: screenshot, contentType: 'image/png' })
    })
}

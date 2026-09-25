import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { abortOnchainReads } from '../helpers/onchain'

// Task 2: classic pages inside Memba OS windows wear the Aqua tokens instead
// of the Beta teal palette. Chain reads and third-party hosts are refused so
// the probes are deterministic (same pattern as os-pages.spec.ts).
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
        // /os/extensions (the brief's suggested probe path) isn't a valid OS deep
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

const APPS = ['feed', 'store', 'settings', 'quests', 'validators', 'tokens', 'profile', 'news', 'explorer', 'arcade', 'feedback', 'dev-report']

// Apps whose classic page is wallet-gated (classicRoute.ts pageNeedsWallet): as a
// guest they render a "Connect a wallet to use <App>." holding pane, never
// .os-classic — that's the only reason .os-classic is allowed to be absent. Any
// other app that never renders it is a real bug (a broken route, an error
// boundary, a regression), not a state to shrug off.
const WALLET_GATED = ['profile']

test('no Beta teal inside the app windows', async ({ page }) => {
    // 12 apps × up to 20s each under 2-worker dev-server contention (plus the
    // fixed 600ms settle + navigation) can exceed the config's 60s default;
    // this doesn't fire on the normal fast path, only when a wait actually
    // needs the extra headroom.
    test.setTimeout(120_000)
    await guest(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    const hits: string[] = []
    for (const app of APPS) {
        await page.goto(`${OS_ON}/os/${app}`)
        const classic = page.locator('.os-classic').first()
        try {
            await classic.waitFor({ timeout: 20_000 })
        } catch {
            if (!WALLET_GATED.includes(app)) throw new Error(`${app}: no .os-classic`)
            test.info().annotations.push({ type: 'skipped', description: `${app}: wallet-gated for a guest, no .os-classic to sweep` })
            continue
        }
        await page.waitForTimeout(600)
        hits.push(...await classic.evaluate((root, app) => {
            const teal = /rgba?\(0, (212|168|230|148), (170|138|187|120)/
            const out: string[] = []
            for (const el of root.querySelectorAll('*')) {
                const s = getComputedStyle(el)
                for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor', 'fill', 'stroke'] as const) {
                    if (teal.test(s[p])) out.push(`${app}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${p}`)
                }
                if (/0, 212, 170|0, 168, 138/.test(s.boxShadow + s.backgroundImage)) out.push(`${app}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} shadow/gradient`)
            }
            return out
        }, app))
    }
    expect(hits).toEqual([])
})

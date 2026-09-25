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
    })
}

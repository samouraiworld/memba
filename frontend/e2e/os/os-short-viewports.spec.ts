import { expect, test, type Locator, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

// The shell on short and zoomed screens: a 1366 × 768 laptop (650 px of page),
// browser zoom at 150%, 200% and 400% (853 × 533, 640 × 400, 320 × 256), and
// the pointer targets and focus rings an accessibility pass found missing.
// Guest sessions past the lock screen; no chain involved.

async function offline(page: Page) {
    await page.route(/memba\.v1\.|\.gno\.land|samourai\.live|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => {
        const url = route.request().url()
        const host = new URL(url).hostname
        if ((host === '127.0.0.1' || host === 'localhost') && !/memba\.v1\./.test(url)) return route.continue()
        return route.abort()
    })
}

type Box = { left: number; top: number; right: number; bottom: number }

/** Panels, windows and dialogs pop in with a short scale animation; measure after it. */
async function settled(target: Locator) {
    await target.waitFor()
    await target.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    return target
}

const rect = (target: Locator): Promise<Box> => target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
})

/** The centre of the element is on screen and nothing else is drawn over it. */
const reachable = (target: Locator) => target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
})

/** A real pointer click at the centre of the element, where it is now: no scrolling it into view first. */
async function clickWhereItIs(page: Page, target: Locator) {
    const r = await rect(target)
    await page.mouse.click((r.left + r.right) / 2, (r.top + r.bottom) / 2)
}

/**
 * Tab through a phone scroller until focus leaves it: the controls that took focus,
 * and those that took it out of sight (under the dock, or above the scroller).
 */
async function tabWalk(page: Page, scroller: string) {
    const seen: string[] = []
    const hidden: string[] = []
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab')
        const at = await page.evaluate((selector) => {
            const el = document.activeElement as HTMLElement
            const box = el.closest(selector)
            if (!box) return null
            const r = el.getBoundingClientRect()
            const dock = document.querySelector('.os-ph-dock')!.getBoundingClientRect()
            return { name: el.getAttribute('aria-label') ?? el.innerText.trim().split('\n').pop()!, under: Math.round(r.bottom - dock.top), above: Math.round(box.getBoundingClientRect().top - r.top) }
        }, scroller)
        if (at) {
            seen.push(at.name)
            if (at.under > 0) hidden.push(`${at.name}: ${at.under} px under the dock`)
            else if (at.above > 0) hidden.push(`${at.name}: ${at.above} px above the scroller`)
        } else if (seen.length) break
    }
    return { seen, hidden }
}

test.describe('Memba OS on short and zoomed screens', () => {
    test.beforeEach(async ({ page }) => {
        await offline(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    })

    test('start menu: fits a 650 px high screen, scrolls under the pointer, and is drawn over the dock', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 650 })
        await page.goto(`${OS_ON}/os`)
        const menuButton = page.getByRole('button', { name: 'Memba menu' })
        const panel = page.locator('.os-panel[data-panel="start"]')
        const commands = page.getByRole('menu', { name: 'Memba' }).getByRole('menuitem')
        await menuButton.click()
        await settled(panel)
        expect((await rect(panel)).bottom).toBeLessThanOrEqual(650)

        // The wheel reaches the end of the panel: every command is on screen and takes the pointer.
        await panel.hover()
        await page.mouse.wheel(0, 2000)
        await expect.poll(() => panel.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop))).toBe(0)
        await expect(commands).toHaveCount(6)
        for (const command of await commands.all()) expect(await reachable(command), await command.innerText()).toBe(true)
        // And back to the top: the first app.
        await page.mouse.wheel(0, -2000)
        await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBe(0)
        expect(await reachable(page.getByRole('menu', { name: 'All apps' }).getByRole('menuitem').first())).toBe(true)
        await page.mouse.wheel(0, 2000)
        await expect.poll(() => reachable(commands.nth(4))).toBe(true)
        await clickWhereItIs(page, commands.nth(4))
        await expect(page.getByRole('region', { name: 'About Memba OS', exact: true })).toBeVisible()

        // 150% zoom: the panel reaches the dock, which used to be drawn over it.
        await page.setViewportSize({ width: 853, height: 533 })
        await menuButton.click()
        await settled(panel)
        const [p, d] = [await rect(panel), await rect(page.getByRole('navigation', { name: 'Dock' }))]
        expect(p.bottom).toBeLessThanOrEqual(533)
        const shared = { left: Math.max(p.left, d.left), top: Math.max(p.top, d.top), right: Math.min(p.right, d.right), bottom: Math.min(p.bottom, d.bottom) }
        expect(shared.right - shared.left, 'the panel and the dock share an area at this size').toBeGreaterThan(20)
        expect(shared.bottom - shared.top, 'the panel and the dock share an area at this size').toBeGreaterThan(20)
        const inPanel = await panel.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)),
            { x: (shared.left + shared.right) / 2, y: (shared.top + shared.bottom) / 2 })
        expect(inPanel).toBe(true)
    })

    test('phone at 200% and 400% zoom: keyboard focus never lands behind the dock', async ({ page }) => {
        await page.setViewportSize({ width: 640, height: 400 })
        await page.goto(`${OS_ON}/os/settings`)
        const sheet = page.locator('.os-ph-sheet')
        await expect(sheet.getByRole('navigation', { name: 'Settings' })).toBeVisible()
        // A sheet takes focus at its title; Tab walks its content from there.
        await expect(sheet.locator('.os-ph-title')).toBeFocused()
        const inSheet = await tabWalk(page, '.os-ph-sheet-b')
        // The walk went through the section list and into the wallpapers, the controls the dock used to cover.
        expect(inSheet.seen).toEqual(expect.arrayContaining(['Transactions', 'Account', 'About', 'Ember wallpaper', 'Mist wallpaper']))
        expect(inSheet.hidden).toEqual([])

        // The home screen scrolls under the dock the same way.
        await page.setViewportSize({ width: 320, height: 256 })
        await sheet.getByRole('button', { name: '‹ Home' }).click()
        await expect(page.getByRole('main', { name: 'Home' }).getByRole('button', { name: 'Connect wallet' })).toBeVisible()
        const onHome = await tabWalk(page, '.os-ph-home')
        expect(onHome.seen).toEqual(expect.arrayContaining(['Connect wallet', 'All apps']))
        expect(onHome.hidden).toEqual([])
    })

    test('window buttons: three 24 px hit areas side by side around the same 12 px dots', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${OS_ON}/os/settings`)
        const win = await settled(page.getByRole('region', { name: 'Settings', exact: true }))
        const names = ['Close Settings', 'Minimise Settings', 'Maximise Settings']
        // For each button: its drawn box, and the box around it that takes the pointer
        // (every pixel within 40 px of its centre, along the row and the column through it).
        const lights = await win.locator('.os-lights').evaluate((group, labels) => labels.map((label) => {
            const el = group.querySelector(`[aria-label="${label}"]`)!
            const r = el.getBoundingClientRect()
            const [cx, cy] = [Math.floor(r.left + r.width / 2), Math.floor(r.top + r.height / 2)]
            const span = (dx: number, dy: number) => {
                const own: number[] = []
                for (let k = -40; k < 40; k++) if (el.contains(document.elementFromPoint(cx + dx * k + 0.25, cy + dy * k + 0.25))) own.push(k)
                return [own[0], own[own.length - 1] + 1]
            }
            const [across, down] = [span(1, 0), span(0, 1)]
            return {
                drawn: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
                hit: { left: cx + across[0], top: cy + down[0], right: cx + across[1], bottom: cy + down[1] },
            }
        }), names)
        const [close, min, max] = lights
        for (const [i, { drawn, hit }] of lights.entries()) {
            expect([drawn.right - drawn.left, drawn.bottom - drawn.top], `${names[i]} is drawn as before`).toEqual([12, 12])
            expect(hit.right - hit.left, `${names[i]} hit width`).toBeGreaterThanOrEqual(24)
            expect(hit.bottom - hit.top, `${names[i]} hit height`).toBeGreaterThanOrEqual(24)
        }
        expect([min.drawn.left - close.drawn.right, max.drawn.left - min.drawn.right]).toEqual([8, 8])
        // Side by side: each area ends where the next begins.
        expect(close.hit.right).toBeLessThanOrEqual(min.hit.left)
        expect(min.hit.right).toBeLessThanOrEqual(max.hit.left)
        // The areas stay inside the title bar, clear of the title.
        const bar = await rect(win.locator('.os-tb'))
        const title = await rect(win.locator('.os-tb-title'))
        expect(close.hit.left).toBeGreaterThanOrEqual(bar.left)
        expect(close.hit.top).toBeGreaterThanOrEqual(bar.top)
        expect(close.hit.bottom).toBeLessThanOrEqual(bar.bottom)
        expect(max.hit.right).toBeLessThanOrEqual(title.left)

        // Right beside them the title bar still drags the window and maximises it on a double click.
        const before = await rect(win)
        const [gx, gy] = [max.hit.right + 3, (bar.top + bar.bottom) / 2]
        await page.mouse.move(gx, gy)
        await page.mouse.down()
        await page.mouse.move(gx + 90, gy + 40, { steps: 6 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await rect(win)).left - before.left)).toBe(90)
        expect(Math.round((await rect(win)).top - before.top)).toBe(40)
        await page.mouse.dblclick(gx + 90, gy + 40)
        await expect(win).toHaveClass(/os-max/)
        // A click at the edge of a hit area, outside the dot, is a click on that button.
        const restore = await rect(win.getByRole('button', { name: 'Restore Settings' }))
        await page.mouse.click(restore.right + 9, restore.top - 5)
        await expect(win).not.toHaveClass(/os-max/)
        const closeNow = await rect(win.getByRole('button', { name: 'Close Settings' }))
        await page.mouse.click(closeNow.left - 9, closeNow.bottom + 5)
        await expect(win).toHaveCount(0)
    })

    test('launcher: the search field and the result list show a focus ring inside the dialog', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
        await page.keyboard.press('Control+k')
        const dialog = page.getByRole('dialog', { name: 'Search and commands' })
        const field = dialog.getByRole('combobox', { name: 'Search' })
        const list = dialog.getByRole('listbox', { name: 'Results' })
        const ring = (stop: Locator) => stop.evaluate((el) => {
            const cs = getComputedStyle(el)
            const probe = document.createElement('i')
            probe.style.color = 'var(--os-acc)'
            el.closest('.memba-os')!.appendChild(probe)
            const accent = getComputedStyle(probe).color
            probe.remove()
            return {
                style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), accent: cs.outlineColor === accent,
                // The dialog clips what leaves it, so the ring has to be drawn inside the box.
                inside: getComputedStyle(el.parentElement!).overflowY === 'hidden' && parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth) <= 0,
            }
        })
        const osRing = { style: 'solid', width: 2, accent: true, inside: true }
        await expect(field).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(list).toBeFocused()
        expect(await ring(list)).toEqual(osRing)
        await page.keyboard.press('Shift+Tab')
        await expect(field).toBeFocused()
        expect(await ring(field)).toEqual(osRing)
    })

    test('Settings reset dialog: centred on the screen', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        await win.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Safety' }).click()
        await win.getByRole('button', { name: 'Reset local app data' }).click()
        const dialog = page.getByRole('dialog', { name: 'Reset local app data' })
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
        const d = await rect(dialog)
        expect(Math.abs((d.left + d.right) / 2 - 640)).toBeLessThanOrEqual(2)
        expect(Math.abs((d.top + d.bottom) / 2 - 400)).toBeLessThanOrEqual(2)

        // 400% zoom, where Settings is a sheet: still centred, inside the screen.
        await page.setViewportSize({ width: 320, height: 256 })
        await page.goto(`${OS_ON}/os/settings`)
        const sheet = page.locator('.os-ph-sheet')
        await sheet.getByRole('button', { name: 'Safety' }).click()
        await sheet.getByRole('button', { name: 'Reset local app data' }).click()
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
        const small = await rect(dialog)
        expect(Math.abs((small.left + small.right) / 2 - 160)).toBeLessThanOrEqual(2)
        expect(Math.abs((small.top + small.bottom) / 2 - 128)).toBeLessThanOrEqual(2)
        expect(small.top).toBeGreaterThanOrEqual(0)
        expect(small.bottom).toBeLessThanOrEqual(256)
    })

    test('Connect dialog at 400% zoom: its top and its bottom both scroll into view', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 256 })
        await page.goto(`${OS_ON}/os`)
        await page.getByRole('main', { name: 'Home' }).getByRole('button', { name: 'Connect wallet' }).click()
        const dialog = await settled(page.getByRole('dialog', { name: 'Connect a wallet' }))
        const d = await rect(dialog)
        expect(d.bottom - d.top, 'the dialog is taller than the screen').toBeGreaterThan(256)
        // The wheel brings the top in, title on screen …
        await page.mouse.move(160, 128)
        await page.mouse.wheel(0, -1000)
        await expect.poll(async () => Math.round((await rect(dialog)).top)).toBeGreaterThanOrEqual(0)
        expect(await reachable(dialog.getByRole('heading', { name: 'Connect a wallet' }))).toBe(true)
        // … and the bottom, where the last button takes the pointer.
        await page.mouse.wheel(0, 1000)
        await expect.poll(async () => Math.round((await rect(dialog)).bottom)).toBeLessThanOrEqual(256)
        expect(await reachable(dialog.getByRole('button', { name: 'Not now' }))).toBe(true)

        // At a normal size nothing changed: centred, and nothing to scroll.
        await page.setViewportSize({ width: 1280, height: 800 })
        const big = await rect(dialog)
        expect(Math.abs((big.top + big.bottom) / 2 - 400)).toBeLessThanOrEqual(1)
        expect(Math.abs((big.left + big.right) / 2 - 640)).toBeLessThanOrEqual(1)
        expect(await dialog.evaluate((el) => el.parentElement!.scrollHeight <= el.parentElement!.clientHeight)).toBe(true)
    })
})

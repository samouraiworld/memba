import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

// Run this spec with all three VITE_ENABLE_* game flags true in the OS dev
// server. It exercises the actual game pages inside OS windows, on both sizes.
async function openLobby(page: Page, width: number) {
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 })
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    await page.goto(`${OS_ON}/os/arcade`)
    const lobby = page.getByRole('region', { name: 'Arcade', exact: true })
    await expect(lobby.getByRole('navigation', { name: 'Arcade' })).toBeVisible()
    return lobby
}

for (const [width, device] of [[1440, 'desktop'], [375, 'phone']] as const) {
    test(`Arcade games play inside the OS on ${device}`, async ({ page }) => {
        test.skip(process.env.OS_ARCADE_PLAY !== 'true', 'gameplay needs the three OS test-server game flags')
        const lobby = await openLobby(page, width)
        await expect(lobby.getByRole('button', { name: /Block Party/ })).toContainText('Play')
        await lobby.getByRole('button', { name: /Block Party/ }).click()
        const block = page.getByRole('region', { name: 'Block Party · Arcade' })
        await expect(block.getByRole('grid', { name: /Block Party signal board/i })).toBeVisible()
        await block.getByRole('tab', { name: 'Practice' }).click()
        await expect(block.getByRole('region', { name: 'Practice game' })).toBeVisible()
        await block.getByRole('grid', { name: /Block Party signal board/i }).focus()
        const before = await block.locator('.k-bp-tile-pos').allTextContents()
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => block.locator('.k-bp-tile-pos').allTextContents()).not.toEqual(before)
        await expect(block.locator('.k-bp-scorebar')).toBeVisible()

        await page.goto(`${OS_ON}/os/arcade`)
        const spaceLobby = page.getByRole('region', { name: 'Arcade', exact: true })
        await spaceLobby.getByRole('button', { name: /Space Invaders/ }).click()
        const space = page.getByRole('region', { name: 'Space Invaders · Arcade' })
        await expect(space.getByRole('heading', { name: 'Space Invaders' })).toBeVisible()
        await space.getByRole('button', { name: /free play/i }).click()
        const surface = space.getByRole('group', { name: /Signal Defense game surface/i })
        await expect(surface).toBeFocused()
        await surface.press('Enter')
        await expect(space.getByRole('heading', { name: /relay standing by/i })).toBeHidden()

        await page.goto(`${OS_ON}/os/arcade`)
        const barricadeLobby = page.getByRole('region', { name: 'Arcade', exact: true })
        await barricadeLobby.getByRole('button', { name: /BARRICADE/ }).click()
        const barricade = page.getByRole('region', { name: 'BARRICADE · Arcade' })
        await expect(barricade.getByRole('group', { name: 'Barricade playfield' })).toBeVisible()
        if (device === 'desktop') {
            const gameWidth = (await barricade.boundingBox())!.width
            expect(gameWidth).toBeGreaterThan(1200)
        }
        await barricade.getByRole('button', { name: 'Practice', exact: true }).click()
        const playfield = barricade.getByRole('group', { name: 'Barricade playfield' })
        await expect(playfield).toBeFocused()
        await playfield.press('ArrowRight')
        await expect(barricade.locator('.bar-sr-only[role="status"]')).toContainText('Lane 2')
        const exit = barricade.getByRole('link', { name: 'Exit game' })
        await expect(exit).toHaveAttribute('href', '/os/arcade')
        await exit.click()
        await expect(page.getByRole('region', { name: 'Arcade', exact: true })).toBeVisible()
        await expect(page.getByRole('region', { name: 'BARRICADE · Arcade' })).toHaveCount(0)
    })

    test(`Arcade game window survives reload beside the lobby on ${device}`, async ({ page }) => {
        const lobby = await openLobby(page, width)
        await lobby.getByRole('button', { name: /BARRICADE/ }).click()
        await expect(page).toHaveURL(/\/os\/arcade\/barricade\?w=app\.arcade/)
        await page.reload()
        await expect(page.getByRole('region', { name: 'BARRICADE · Arcade' })).toBeVisible()
        if (device === 'desktop') await expect(page.getByRole('region', { name: 'Arcade', exact: true })).toBeVisible()
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('memba_os_windows:guest:gnoland-1') ?? '[]') as { token: string }[])
        expect(saved.map(({ token }) => token)).toEqual(expect.arrayContaining(['app.arcade', 'arcade.barricade']))
    })

    test(`Arcade lobby states are clear on ${device}`, async ({ page }) => {
        const lobby = await openLobby(page, width)
        await lobby.getByRole('button', { name: 'Your runs' }).click()
        await expect(lobby.getByRole('status')).toContainText('not a certified Arcade record')
        await lobby.getByRole('button', { name: 'Daily board' }).click()
        await expect(lobby.getByRole('status')).toContainText('attestation is off')
    })
}

test('a Block Party run ignores other windows and survives minimise', async ({ page }) => {
    test.skip(process.env.OS_ARCADE_PLAY !== 'true', 'gameplay needs the OS test-server game flags')
    const lobby = await openLobby(page, 1440)
    await lobby.getByRole('button', { name: /Block Party/ }).click()
    const block = page.getByRole('region', { name: 'Block Party · Arcade' })
    await block.getByRole('tab', { name: 'Practice' }).click()
    const board = block.getByRole('grid', { name: /Block Party signal board/i })
    const snapshot = () => board.getByRole('gridcell').evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label')).join('|'))
    await board.focus()
    const start = await snapshot()
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
        await page.keyboard.press(key)
        if (await snapshot() !== start) break
    }
    const played = await snapshot()
    expect(played).not.toBe(start)

    await block.locator('.os-tb-title').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await snapshot()).toBe(played)

    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Arcade', exact: true }).click()
    await expect(lobby).toBeVisible()
    await page.keyboard.press('ArrowUp')
    expect(await snapshot()).toBe(played)

    await block.getByRole('button', { name: 'Minimise Block Party · Arcade' }).click()
    await expect(block).toHaveCount(0)
    const parked = page.locator('.os-parked[data-win="game:game"]')
    await expect(parked).toBeHidden()
    await page.getByRole('button', { name: 'Restore Block Party · Arcade' }).click()
    await expect(block).toBeVisible()
    expect(await snapshot()).toBe(played)
})

test('a phone Arcade run survives Home and Back in the same session', async ({ page }) => {
    test.skip(process.env.OS_ARCADE_PLAY !== 'true', 'gameplay needs the OS test-server game flags')
    const lobby = await openLobby(page, 375)
    await lobby.getByRole('button', { name: /Block Party/ }).click()
    const block = page.getByRole('region', { name: 'Block Party · Arcade' })
    await block.getByRole('tab', { name: 'Practice' }).click()
    const board = block.getByRole('grid', { name: /Block Party signal board/i })
    const snapshot = () => board.getByRole('gridcell').evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label')).join('|'))
    await board.focus()
    const start = await snapshot()
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
        await page.keyboard.press(key)
        if (await snapshot() !== start) break
    }
    const played = await snapshot()
    expect(played).not.toBe(start)
    await block.getByRole('button', { name: '‹ Home' }).click()
    await expect(block).toHaveCount(0)
    await page.goBack()
    await expect(block).toBeVisible()
    expect(await snapshot()).toBe(played)
})

test('a desktop game pauses while wallet connection blocks the desk', async ({ page }) => {
    test.skip(process.env.OS_ARCADE_PLAY !== 'true', 'gameplay needs the OS test-server game flags')
    const lobby = await openLobby(page, 1440)
    await lobby.getByRole('button', { name: /BARRICADE/ }).click()
    const barricade = page.getByRole('region', { name: 'BARRICADE · Arcade' })
    await barricade.getByRole('button', { name: 'Practice', exact: true }).click()
    await expect(barricade.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('status').getByRole('button', { name: 'Connect to sign' }).click()
    await expect(page.getByRole('dialog', { name: /connect a wallet/i })).toBeVisible()
    await expect(page.locator('.bar-pause')).toHaveCount(1)
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(barricade.getByRole('dialog', { name: 'Run paused' })).toBeVisible()
})

test.describe('Arcade touch play in a phone context', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

    test('all three games accept touch input inside the OS', async ({ page, browserName }) => {
        // Playwright's Firefox mobile-touch context stalls before navigation on
        // setViewportSize in this harness; phone layout still runs above in Firefox.
        test.skip(browserName === 'firefox', 'Firefox mobile-touch context cannot initialize in this harness')
        test.skip(process.env.OS_ARCADE_PLAY !== 'true', 'gameplay needs the three OS test-server game flags')
        const lobby = await openLobby(page, 375)
        await lobby.getByRole('button', { name: /Block Party/ }).tap()
        const block = page.getByRole('region', { name: 'Block Party · Arcade' })
        await block.getByRole('tab', { name: 'Practice' }).tap()
        const board = block.getByRole('grid', { name: /Block Party signal board/i })
        const snapshot = () => board.getByRole('gridcell').evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label')).join('|'))
        const before = await snapshot()
        for (const [dx, dy] of [[-80, 0], [0, -80], [80, 0], [0, 80]]) {
            await board.evaluate((element, [moveX, moveY]) => {
                const rect = element.getBoundingClientRect()
                const x = rect.left + rect.width / 2
                const y = rect.top + rect.height / 2
                element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1 }))
                element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + moveX, clientY: y + moveY, pointerType: 'touch', pointerId: 1 }))
            }, [dx, dy])
            if (await snapshot() !== before) break
        }
        expect(await snapshot()).not.toBe(before)

        await page.goto(`${OS_ON}/os/arcade`)
        await page.getByRole('region', { name: 'Arcade', exact: true }).getByRole('button', { name: /Space Invaders/ }).tap()
        const space = page.getByRole('region', { name: 'Space Invaders · Arcade' })
        await space.getByRole('button', { name: /free play/i }).tap()
        const surface = space.getByRole('group', { name: /Signal Defense game surface/i })
        await surface.evaluate(element => {
            const rect = element.getBoundingClientRect()
            const touch = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: rect.x + rect.width * .75, clientY: rect.y + rect.height * .72 }
            element.dispatchEvent(new PointerEvent('pointerdown', touch))
            element.dispatchEvent(new PointerEvent('pointerup', touch))
        })
        await expect(space.getByRole('heading', { name: /relay standing by/i })).toBeHidden()

        await page.goto(`${OS_ON}/os/arcade`)
        await page.getByRole('region', { name: 'Arcade', exact: true }).getByRole('button', { name: /BARRICADE/ }).tap()
        const barricade = page.getByRole('region', { name: 'BARRICADE · Arcade' })
        await barricade.getByRole('button', { name: 'Practice', exact: true }).tap()
        const canvas = barricade.locator('.bar-canvas')
        const rect = (await canvas.boundingBox())!
        await page.touchscreen.tap(rect.x + rect.width * .8, rect.y + rect.height * .6)
        await expect(barricade.locator('.bar-sr-only[role="status"]')).toContainText('Lane 3')
    })
})

import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

// Run this spec with all three VITE_ENABLE_* game flags true in the OS dev
// server. It exercises the actual game pages inside OS windows, on both sizes.
async function openLobby(page: Page, width: number) {
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 })
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_booted', '1')
    })
    await page.goto(`${OS_ON}/os/arcade`)
    const lobby = page.getByRole('region', { name: 'Arcade', exact: true })
    await expect(lobby.getByRole('navigation', { name: 'Arcade' })).toBeVisible()
    return lobby
}

for (const [width, device] of [[1440, 'desktop'], [375, 'phone']] as const) {
    test(`Arcade games play inside the OS on ${device}`, async ({ page }) => {
        const lobby = await openLobby(page, width)
        await expect(lobby.getByRole('button', { name: /Block Party/ })).toContainText('Play')
        await lobby.getByRole('button', { name: /Block Party/ }).click()
        const block = page.getByRole('region', { name: 'Block Party · Arcade' })
        await expect(block.getByRole('grid', { name: /Block Party signal board/i })).toBeVisible()
        await block.getByRole('tab', { name: 'Practice' }).click()
        await expect(block.getByRole('region', { name: 'Practice game' })).toBeVisible()
        await block.getByRole('grid', { name: /Block Party signal board/i }).focus()
        await page.keyboard.press('ArrowLeft')
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
    })

    test(`Arcade lobby states are clear on ${device}`, async ({ page }) => {
        const lobby = await openLobby(page, width)
        await lobby.getByRole('button', { name: 'Your runs' }).click()
        await expect(lobby.getByRole('status')).toContainText('not a certified Arcade record')
        await lobby.getByRole('button', { name: 'Daily board' }).click()
        await expect(lobby.getByRole('status')).toContainText('attestation is off')
    })
}

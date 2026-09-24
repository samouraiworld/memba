import { expect, test } from '@playwright/test'
import { OS_OFF, OS_ON } from '../../playwright.os.config'

test.describe('Memba OS foundations', () => {
    test('renders the empty desktop in light', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' })
        await page.goto(`${OS_ON}/os`)
        const os = page.getByTestId('memba-os')
        await expect(os).toBeVisible()
        await expect(os).toHaveAttribute('data-os-theme', 'light')
        await expect(page.getByRole('banner', { name: 'Menu bar' })).toBeVisible()
    })

    test('renders the empty desktop in dark', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByTestId('memba-os')).toHaveAttribute('data-os-theme', 'dark')
    })

    test('follows a system theme change without a reload', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' })
        await page.goto(`${OS_ON}/os`)
        const os = page.getByTestId('memba-os')
        await expect(os).toHaveAttribute('data-os-theme', 'light')
        await page.emulateMedia({ colorScheme: 'dark' })
        await expect(os).toHaveAttribute('data-os-theme', 'dark')
    })

    test('leaves the current app untouched when the flag is on', async ({ page }) => {
        await page.goto(`${OS_ON}/mainnet/settings`)
        await expect(page.getByTestId('memba-os')).toHaveCount(0)
    })

    test('keeps /os unreachable when the flag is off', async ({ page }) => {
        await page.goto(`${OS_OFF}/os`)
        // The network routes take over exactly as before Memba OS: "os" isn't a
        // network, so the legacy redirect prefixes the default one.
        await expect(page).toHaveURL(`${OS_OFF}/mainnet/os`)
        await expect(page.getByTestId('memba-os')).toHaveCount(0)
    })
})

import { expect, test, type Locator } from '@playwright/test'

/** Scan after all visible loading states settle. A persistent status is annotated
 * after the bounded wait, and the accessibility/colour scan still runs. */
export async function settle(root: Locator, timeout = 20_000) {
    try {
        await expect(root.locator('[role="status"]:visible, .os-spin:visible')).toHaveCount(0, { timeout })
    } catch {
        test.info().annotations.push({ type: 'unsettled', description: 'a visible [role=status]/.os-spin element remained after the settle timeout' })
    }
}

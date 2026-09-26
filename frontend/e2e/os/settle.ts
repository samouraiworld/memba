import { expect, test, type Locator, type Page } from '@playwright/test'

/** Scan after all visible loading states settle. A persistent status is annotated
 * after the bounded wait, and the accessibility/colour scan still runs. */
export async function settle(root: Locator, timeout = 20_000) {
    try {
        await expect(root.locator('[role="status"]:visible, .os-spin:visible')).toHaveCount(0, { timeout })
    } catch {
        test.info().annotations.push({ type: 'unsettled', description: 'a visible [role=status]/.os-spin element remained after the settle timeout' })
    }
}

/** Finite entrance animations settle before colour scans. Infinite spinners and
 * paused animations must not stop a scan after its loader wait has timed out. */
export async function settleAnimations(page: Page, timeout = 1_500) {
    const finished = await page.evaluate(async (limit) => {
        const finite = document.getAnimations().filter((animation) => {
            const end = animation.effect?.getComputedTiming().endTime
            return animation.playState === 'running' && animation.playbackRate !== 0
                && typeof end === 'number' && Number.isFinite(end)
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            return await Promise.race([
                Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))).then(() => true),
                new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), limit) }),
            ])
        } finally { clearTimeout(timer) }
    }, timeout)
    if (!finished) test.info().annotations.push({ type: 'unsettled', description: 'a finite animation remained after the colour-settle timeout' })
}

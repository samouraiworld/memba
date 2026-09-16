import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/** The app's own version, as vite injects it into __APP_VERSION__. */
const APP_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version

/**
 * Mark the current release announcement as already seen. WhatsNewToast opens a
 * modal three seconds after load whenever the stored version differs from the
 * app version, so a hardcoded version goes stale at the next release and the
 * dialog starts intercepting clicks in slower runs.
 */
export async function suppressReleaseAnnouncement(page: Page): Promise<void> {
    await page.addInitScript((version) => localStorage.setItem('memba_whats_new_seen', version), APP_VERSION)
}

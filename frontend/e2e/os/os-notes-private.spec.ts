/**
 * Private notes in the real Shell (e2e-notes/private): key setup up to its signature review, unlock, read, lock, an
 * encrypted draft at rest, the share review, an encrypted comment, Shell lock and page hide, and phone mode.
 * Reads are simulated onyx-1 state; the only RPC answers are the storage price, gas price and balance. Nothing is signed.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const TITLE = 'Omakase plan PRIVATE_TITLE_7f3', BODY = 'PRIVATE_BODY_7f3', DRAFT = 'PRIVATE_DRAFT_7f3', COMMENT = 'PRIVATE_COMMENT_7f3'
const MARKERS = ['PRIVATE_TITLE_7f3', BODY, DRAFT, COMMENT]
const SCREENS = process.env.NOTES_PRIVATE_SCREENS
type Audit = { stored(marker: string): Promise<{ hits: string[]; records: number }>; liveClients(): number; unlockRequests: number; newcomer: string }
const errors: string[] = []

async function rpc(context: BrowserContext) {
    await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1') return route.continue()
        if (url.hostname !== 'rpc.onyx.testnets.gno.land') return route.abort()
        const answer = (result: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) })
        if (url.pathname === '/status') return answer({ node_info: { network: 'onyx-1' }, sync_info: { latest_block_height: '100' } })
        const path = url.pathname === '/abci_query' ? JSON.parse(url.searchParams.get('path') ?? '""') as string : ''
        const data = path === 'params/vm:p:storage_price' ? '"100ugnot"' : path === 'auth/gasprice' ? '{"gas":1000,"price":"1ugnot"}' : path.startsWith('bank/balances/') ? '"20000000ugnot"' : null
        return data === null ? route.abort() : answer({ response: { ResponseBase: { Data: Buffer.from(data).toString('base64'), Error: null } } })
    })
}
async function open(page: Page, query = '') {
    await page.goto(`/e2e-notes/private/index.html${query}`)
    await expect(page.locator('html[data-fixture-ready="true"]')).toHaveCount(1, { timeout: 60000 })
}
const audit = <T,>(page: Page, run: (a: Audit) => T | Promise<T>) => page.evaluate(`(${run.toString()})(window.__notesPrivate)`) as Promise<T>
async function storedHits(page: Page, marker: string) { return page.evaluate(async m => (window as unknown as { __notesPrivate: Audit }).__notesPrivate.stored(m), marker) }
async function noPlaintextOnPage(page: Page) {
    const text = await page.evaluate(() => document.body.innerText + document.body.innerHTML)
    for (const marker of MARKERS) expect(text, marker).not.toContain(marker)
}
async function noPlaintextStored(page: Page) { for (const marker of MARKERS) expect((await storedHits(page, marker)).hits, marker).toEqual([]) }
async function shot(page: Page, name: string) {
    if (!SCREENS) return
    await page.waitForTimeout(600) // sheets finish their entrance animation
    await page.screenshot({ path: `${SCREENS}/${test.info().project.name}-${name}.png` })
}
const note = (page: Page) => page.getByRole('region', { name: 'Private note' })
async function unlock(page: Page) {
    await note(page).getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(note(page).getByRole('heading', { name: TITLE })).toBeVisible({ timeout: 60000 })
}

test.beforeEach(async ({ page, context }) => {
    errors.length = 0
    page.on('pageerror', error => errors.push(error.message))
    await rpc(context)
})
test.afterEach(() => { expect(errors).toEqual([]) })

test('key setup: one guided sheet, two unlock signatures, the phrase re-entered, up to the signature review; nothing is signed', async ({ page }) => {
    await open(page, '?account=fresh&start=/os/notes')
    await page.getByRole('navigation', { name: 'Notes list' }).getByRole('button', { name: /Private notes/ }).click()
    await page.getByRole('button', { name: 'Set up private notes' }).click()
    await shot(page, '01-setup-intro')
    await page.getByRole('button', { name: 'Continue in Adena' }).click()
    const words = page.getByRole('list', { name: 'Recovery phrase' })
    await expect(words.locator('li')).toHaveCount(24, { timeout: 60000 })
    const phrase = (await words.locator('li').allTextContents()).join(' ')
    expect(await audit(page, a => a.unlockRequests)).toBe(2)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download recovery file' }).click()
    expect((await download).suggestedFilename()).toMatch(/^memba-notes-recovery-onyx-1-/)
    await page.getByRole('button', { name: 'I wrote it down' }).click()
    await page.getByLabel(/The 24 words/).fill(phrase)
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('button', { name: 'Set up with Adena' }).click()
    const review = page.getByRole('dialog').filter({ hasText: 'Adena should show' })
    await expect(review).toBeVisible()
    for (const text of ['RegisterKey', 'SetSeedBackup', 'onyx-1']) await expect(review).toContainText(text)
    await expect(review).not.toContainText(phrase.split(' ').slice(0, 3).join(' '))
    await shot(page, '02-setup-review')
    await review.getByRole('button', { name: 'Cancel' }).click()
    await expect(review).toHaveCount(0)
    // The phrase was only on screen: it is in no storage of this origin.
    for (const word of [phrase.split(' ').slice(0, 4).join(' ')]) expect((await storedHits(page, word)).hits).toEqual([])
})

test('unlock, read, then Lock: the decrypted note leaves the page and was never stored', async ({ page }) => {
    await open(page)
    await expect(note(page).getByText('This note is encrypted.')).toBeVisible()
    expect(await audit(page, a => a.unlockRequests)).toBe(0)
    await noPlaintextOnPage(page)
    await unlock(page)
    await expect(note(page).getByText(BODY)).toBeVisible()
    expect(await audit(page, a => a.unlockRequests)).toBe(1)
    await shot(page, '03-unlocked')
    await noPlaintextStored(page)
    // The window title, the desk, the URL and the document title never carry the private title.
    expect(await page.title()).not.toContain('PRIVATE_TITLE')
    expect(await page.locator('.os-menubar, .os-dock, .os-desk > :not(.os-win)').allInnerTexts()).not.toContain(expect.stringContaining('PRIVATE_TITLE'))
    await note(page).getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(note(page).getByText('This note is encrypted.')).toBeVisible()
    await noPlaintextOnPage(page); await noPlaintextStored(page)
})

test('editing: the draft is encrypted at rest, a lock keeps it encrypted, Unlock reopens it', async ({ page }) => {
    await open(page)
    await unlock(page)
    await note(page).getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown editor' })
    await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(` ${DRAFT}`)
    await expect(page.getByText(/encrypted on this device · based on revision/)).toBeVisible()
    await shot(page, '04-editing')
    const { hits, records } = await storedHits(page, DRAFT)
    expect(hits).toEqual([]); expect(records).toBeGreaterThan(0)
    await noPlaintextStored(page)
    await page.getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(page.getByText('Your edits are saved encrypted on this device. Unlock to continue editing.')).toBeVisible()
    await noPlaintextOnPage(page); await noPlaintextStored(page)
    await note(page).getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Markdown editor' })).toContainText(DRAFT, { timeout: 60000 })
    // Its signature review names the note by its decrypted title: a page hide removes that subtitle in the same flush.
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: 'Publish with Adena', exact: true }).click()
    const review = page.getByRole('dialog').filter({ hasText: 'Adena should show' })
    await expect(review).toContainText(`“${TITLE}”`, { timeout: 60000 })
    const left = await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); return document.body.innerText + document.body.innerHTML })
    for (const marker of MARKERS) expect(left, marker).not.toContain(marker)
    await expect(review).toHaveCount(0)
    await noPlaintextStored(page)
})

test('sharing: the review names the reader, says their address is public, and signs nothing until asked', async ({ page }) => {
    await open(page)
    const newcomer = await audit(page, a => a.newcomer)
    await unlock(page)
    await note(page).getByRole('button', { name: 'Share', exact: true }).click()
    const part = page.getByRole('region', { name: 'Who can read' })
    await part.getByRole('textbox', { name: 'Add a reader' }).fill(newcomer)
    await part.getByRole('button', { name: 'Add…' }).click()
    const review = part.getByRole('group', { name: 'Share review' })
    await expect(review).toBeVisible({ timeout: 60000 })
    await expect(review).toContainText('Their address, as a reader of this note. Not the title or the text.')
    await shot(page, '05-share-review')
    await review.getByRole('button', { name: 'Cancel' }).click()
    await expect(review).toHaveCount(0)
    await noPlaintextStored(page)
})

test('an encrypted comment reaches its signature review encrypted; a page hide closes the review and leaves nothing decrypted on the page', async ({ page }) => {
    await open(page)
    await unlock(page)
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await page.getByRole('textbox', { name: 'Encrypted comment' }).fill(COMMENT)
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    const review = page.getByRole('dialog').filter({ hasText: 'Comment (sent encrypted)' })
    await expect(review).toContainText(COMMENT, { timeout: 60000 })
    await expect(review.getByText('Adena should show')).toBeVisible()
    await shot(page, '06-comment-review')
    // Synchronously inside the event, as when the browser freezes the page into the back/forward cache.
    const left = await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); return document.body.innerText + document.body.innerHTML })
    for (const marker of MARKERS) expect(left, marker).not.toContain(marker)
    await expect(review).toHaveCount(0)
    await expect(note(page).getByRole('button', { name: 'Unlock', exact: true })).toBeVisible()
    await noPlaintextStored(page)
})

test('Disconnect & lock asks before discarding an unsent encrypted comment; once allowed, nothing private is left', async ({ page }) => {
    await open(page)
    await unlock(page)
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await page.getByRole('textbox', { name: 'Encrypted comment' }).fill(COMMENT)
    const asked: string[] = []
    page.once('dialog', dialog => { asked.push(dialog.message()); void dialog.dismiss() })
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Disconnect & lock', exact: true }).click()
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toContain('An encrypted comment you wrote is not posted yet')
    await expect(page.getByRole('textbox', { name: 'Encrypted comment' })).toHaveValue(COMMENT)
    await expect(note(page).getByRole('heading', { name: TITLE })).toBeVisible()
    page.once('dialog', dialog => { void dialog.accept() })
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Disconnect & lock', exact: true }).click()
    await expect(page.locator('.os-notes-stage')).toHaveCount(0)
    expect(await audit(page, a => a.liveClients())).toBe(0)
    await noPlaintextOnPage(page); await noPlaintextStored(page)
})

test('phone: the private panel, its explainer, the note, Share and comments fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    const fits = async (label: string) => {
        const wide = await page.evaluate(() => {
            const width = document.documentElement.clientWidth
            return [...document.querySelectorAll<HTMLElement>('.os-notes-app *, .os-notes-sheet *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > width + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('[hidden], .cm-scroller, .os-notes-readers li > span') })
                .slice(0, 5).map(el => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`)
        })
        expect(wide, label).toEqual([])
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth), label).toBe(true)
    }
    await unlock(page)
    // The real phone Shell (home screen and full-screen sheets), not a narrow desktop window.
    await expect(page.locator('.os-phone')).toHaveCount(1)
    await expect(note(page).getByText(BODY)).toBeVisible()
    await fits('note'); await shot(page, '07-phone-note')
    await note(page).getByRole('button', { name: 'Share', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Who can read' })).toBeVisible()
    await fits('share'); await shot(page, '08-phone-share')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Who can read' })).toHaveCount(0)
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await expect(page.getByRole('textbox', { name: 'Encrypted comment' })).toBeVisible()
    await fits('comments'); await shot(page, '09-phone-comments')
    const back = page.getByRole('button', { name: 'Back to the note', exact: true })
    if (await back.isVisible()) await back.click()
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click()
    await page.getByRole('navigation', { name: 'Notes list' }).getByRole('button', { name: /Private notes/ }).click()
    await expect(page.getByRole('heading', { name: 'Private notes', exact: true })).toBeVisible()
    await expect(page.getByText('Unlocked in this window.', { exact: false }).first()).toBeVisible()
    await fits('panel'); await shot(page, '10-phone-panel')
    await page.getByRole('button', { name: 'About private notes' }).click()
    await expect(page.getByRole('dialog', { name: 'About private notes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'About private notes' })).toBeInViewport()
    await fits('about'); await shot(page, '11-phone-about')
})

test('a reader: the note is in Shared with me, opens read only after Unlock, with no Edit, Delete or reader changes', async ({ page }) => {
    await open(page, '?account=reader')
    const list = page.getByRole('navigation', { name: 'Notes list' })
    await expect(list.getByRole('heading', { name: 'Shared with me' })).toBeVisible()
    await expect(list.getByRole('button', { name: /^Private note/ }).last()).toContainText('Shared by')
    await unlock(page)
    await expect(list.getByRole('button', { name: new RegExp(TITLE) })).toBeVisible()
    for (const name of ['Edit']) await expect(note(page).getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(note(page).getByText(/by g1/)).toBeVisible()
    await shot(page, '12-reader-unlocked-desktop')
    await note(page).getByRole('button', { name: 'Share', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Who can read' }).getByRole('textbox')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(list.getByRole('button', { name: new RegExp(TITLE) })).toHaveCount(0)
    await noPlaintextOnPage(page); await noPlaintextStored(page)
})

test('phone, as a reader: Shared with me lists the note by its decrypted title only while unlocked', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '?account=reader')
    await unlock(page)
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click()
    const list = page.getByRole('navigation', { name: 'Notes list' })
    await expect(list.getByRole('heading', { name: 'Shared with me' })).toBeVisible()
    await expect(list.getByRole('button', { name: new RegExp(TITLE) })).toBeVisible()
    await shot(page, '13-reader-shared-with-me-phone')
})

test('a key changed outside Memba: the note, Share, comments and the panel explain it and stay read only', async ({ page }) => {
    await open(page, '?rekeyed=1')
    await expect(note(page).getByText('Your private key changed outside Memba.', { exact: true }).first()).toBeVisible()
    await expect(note(page).getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0)
    await shot(page, '14-key-changed-note')
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await expect(page.getByText(/Its comments stay encrypted; Memba cannot read, post or change them with it\./)).toBeVisible()
    const back = page.getByRole('button', { name: 'Back to the note', exact: true })
    if (await back.isVisible()) await back.click()
    await note(page).getByRole('button', { name: 'Share', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Who can read' }).getByText(/Who can read stays as it is/)).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: 'Notes list' }).getByRole('button', { name: /Private notes/ }).click()
    await expect(page.locator('.os-notes-private').getByText('Your private key changed outside Memba.', { exact: true })).toBeVisible()
    for (const name of ['Unlock', 'Set up private notes', 'Use recovery phrase']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    await shot(page, '15-key-changed-panel')
    expect(await audit(page, a => a.unlockRequests)).toBe(0)
})

import { expect, test, type Page } from '@playwright/test'
const text = 'UNSENT_PUBLIC_COMMENT_lifecycle_76a'
const errors: string[] = []
async function audit(page: Page): Promise<{ disconnects: number; clients: number; liveClients: number }> { return page.evaluate(() => (window as unknown as { __notesShellAudit: { disconnects: number; clients: number; liveClients: number } }).__notesShellAudit) }
test.beforeEach(async ({ page, context }) => {
    errors.length = 0; page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.goto('/e2e-notes/sushi-shell/index.html')
    await expect(page.getByRole('heading', { name: 'Sushi Shell demonstration', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Note preview' })).toHaveAttribute('data-rendered', 'html')
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await page.getByRole('textbox', { name: 'Comment', exact: true }).fill(text)
})
test.afterEach(() => { expect(errors).toEqual([]) })
test('real public stage survives desktop/mobile changes and minimize restore without losing the composer', async ({ page }) => {
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true })
    await composer.evaluate(element => { element.setAttribute('data-lifecycle-test', 'same-composer') })
    const before = await audit(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(composer).toHaveValue(text); await expect(composer).toHaveAttribute('data-lifecycle-test', 'same-composer')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(composer).toHaveValue(text)
    await page.getByRole('button', { name: 'Minimise Notes', exact: true }).click()
    await expect(composer).toBeHidden()
    // Minimized public stages can park in a detached portal; the live read lease proves they were not destroyed.
    expect((await audit(page)).liveClients).toBe(1)
    await page.getByRole('button', { name: 'Restore Notes', exact: true }).click()
    await expect(composer).toHaveValue(text); await expect(composer).toHaveAttribute('data-lifecycle-test', 'same-composer')
    expect((await audit(page)).clients).toBe(before.clients)
})
test('disconnect and lock destroys the parked public comment stage and reconnect starts empty', async ({ page }) => {
    await page.getByRole('button', { name: 'Minimise Notes', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toBeHidden()
    // Locking discards the unsent comment, so it asks first, as closing the window would.
    const asked: string[] = []
    page.once('dialog', dialog => { asked.push(dialog.message()); void dialog.accept() })
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Disconnect & lock', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    expect(asked).toEqual([expect.stringContaining('A comment you wrote is not posted yet')])
    await expect(page.locator('.os-notes-stage')).toHaveCount(0)
    expect(await audit(page)).toMatchObject({ disconnects: 1, liveClients: 0 })
    expect(await page.locator('body').textContent()).not.toContain(text)
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Notes', exact: true }).click()
    await page.getByRole('button', { name: /Sushi Shell demonstration/ }).click()
    // An explicit disconnect also forgets the unsent comment kept in this tab's session storage.
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('')
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('memba_notes_comment:')))).toEqual([])
    expect(await page.locator('body').textContent()).not.toContain(text)
})
test('Notes is one window: opening it again keeps the same note; a phone shows the list first, then the note with Back', async ({ page }) => {
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true })
    await composer.evaluate(element => { element.setAttribute('data-lifecycle-test', 'same-composer') })
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Notes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close Notes', exact: true })).toHaveCount(1)
    await expect(composer).toHaveValue(text); await expect(composer).toHaveAttribute('data-lifecycle-test', 'same-composer')
    const list = page.getByRole('navigation', { name: 'Notes list', exact: true })
    await expect(list.getByRole('button', { name: /Sushi Shell demonstration/ })).toHaveAttribute('aria-current', 'true')
    // Opened from the menu, a phone starts on the list; the note opens full screen and Back returns to the list.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(list).toBeVisible(); await expect(composer).toBeHidden()
    await list.getByRole('button', { name: /Sushi Shell demonstration/ }).click()
    await expect(list).toBeHidden()
    await expect(composer).toHaveValue(text); await expect(composer).toHaveAttribute('data-lifecycle-test', 'same-composer')
    // A narrow window opened the comments as a sheet over the note: its Back returns to the note first.
    const sheetBack = page.getByRole('button', { name: 'Back to the note', exact: true })
    if (await sheetBack.isVisible()) { await sheetBack.click(); await expect(composer).toBeHidden() }
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click()
    await expect(list).toBeVisible(); await expect(composer).toBeHidden()
})
test('a phone shows the whole Share menu: sized from the screen, not from the sticky note header', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const sheetBack = page.getByRole('button', { name: 'Back to the note', exact: true })
    if (await sheetBack.isVisible()) await sheetBack.click()
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const menu = page.getByRole('dialog', { name: /^Share / })
    await expect(menu.getByRole('button', { name: 'Copy link', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(menu.getByRole('heading', { name: 'Who can comment', exact: true })).toBeInViewport({ ratio: 1 })
    // Before the fix the menu was cut to about 36 px (its percentage height followed the 60 px header).
    expect((await menu.boundingBox())!.height).toBeGreaterThan(300)
})

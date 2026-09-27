import { expect, test } from "@playwright/test"
import { OS_ON } from "../../playwright.os.config"
import { abortOnchainReads } from "../helpers/onchain"

test.beforeEach(async ({ page }) => {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]|youtube/, (route) => route.abort())
    await abortOnchainReads(page)
    await page.addInitScript(() => localStorage.setItem("memba_os_seen", "1"))
    await page.setViewportSize({ width: 1400, height: 900 })
})

test("a guest can use bounded read commands without opening a wallet", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await expect(terminal.getByText("gnoland-1")).toBeVisible()
    const prompt = terminal.getByRole("textbox", { name: "Command" })
    await prompt.fill("help")
    await terminal.getByRole("button", { name: "Run query" }).click()
    await expect(terminal.getByRole("log")).toContainText("render <realm>")
    await prompt.fill("eval r/demo/boards Get()")
    await prompt.press("Enter")
    await expect(terminal.getByRole("log")).toContainText("Unknown command")
    await expect(page.getByRole("dialog", { name: /Connect|Review/ })).toHaveCount(0)
    await prompt.fill("clear")
    await prompt.press("Enter")
    await expect(terminal.getByRole("log")).not.toContainText("Unknown command")
})

test("a guest draft saves locally and Learn loads its video after a click", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await terminal.getByRole("button", { name: "Build draft" }).click()
    const path = terminal.getByRole("textbox", { name: "Realm path" })
    await path.fill("gno.land/r/myname/tutorial")
    await terminal.getByRole("button", { name: "Explore" }).click()
    await terminal.getByRole("button", { name: "Build draft" }).click()
    await expect(terminal.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/myname/tutorial")
    await terminal.getByRole("textbox", { name: "Gno source editor" }).fill("/* package tutorial */\npackage hello\n")
    await expect(terminal.getByText("The source must declare package tutorial.")).toBeVisible()
    await expect(terminal.getByRole("textbox", { name: "Gno source editor" })).toBeVisible()
    await expect(terminal.getByText("Saved locally")).toBeVisible()
    await page.reload()
    await page.getByRole("region", { name: "Terminal", exact: true }).getByRole("button", { name: "Build draft" }).click()
    await expect(page.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/myname/tutorial")
    await terminal.getByRole("button", { name: "Learn" }).click()
    const learn = page.getByRole("region", { name: "Learn", exact: true })
    await expect(learn.locator("iframe")).toHaveCount(0)
    await learn.getByRole("button", { name: "Load playlist" }).click()
    await expect(learn.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/videoseries/)
})

test("an oversized source paste cannot replace a saved draft", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await terminal.getByRole("button", { name: "Build draft" }).click()
    const editor = terminal.getByRole("textbox", { name: "Gno source editor" })
    await expect(editor).toContainText("Hello from Gno")
    await editor.fill("x".repeat(32_769))
    await expect(terminal.getByText("Keep this small package below 32 KB.")).toBeVisible()
    await expect(editor).toContainText("Hello from Gno")
    await page.reload()
    await page.getByRole("region", { name: "Terminal", exact: true }).getByRole("button", { name: "Build draft" }).click()
    await expect(page.getByRole("textbox", { name: "Gno source editor" })).toContainText("Hello from Gno")
})

test("an oversized paste does not undo an earlier deliberate deletion", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await terminal.getByRole("button", { name: "Build draft" }).click()
    const editor = terminal.getByRole("textbox", { name: "Gno source editor" })
    await editor.fill("")
    await expect(editor).toBeEmpty()
    await page.waitForTimeout(150)
    await editor.fill("x".repeat(32_769))
    await expect(terminal.getByText("Keep this small package below 32 KB.")).toBeVisible()
    await expect(editor).toBeEmpty()
    await page.reload()
    await page.getByRole("region", { name: "Terminal", exact: true }).getByRole("button", { name: "Build draft" }).click()
    await expect(page.getByRole("textbox", { name: "Gno source editor" })).toBeEmpty()
})

test("a guest can recall earlier commands with arrow keys", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    const prompt = terminal.getByRole("textbox", { name: "Command" })
    await prompt.fill("help")
    await prompt.press("Enter")
    await prompt.fill("unknown")
    await prompt.press("Enter")
    await prompt.press("ArrowUp")
    await expect(prompt).toHaveValue("unknown")
    await prompt.press("ArrowUp")
    await expect(prompt).toHaveValue("help")
    await prompt.press("ArrowDown")
    await expect(prompt).toHaveValue("unknown")
    await prompt.press("ArrowDown")
    await prompt.fill("partially typed")
    await prompt.press("ArrowUp")
    await expect(prompt).toHaveValue("unknown")
    await prompt.press("ArrowDown")
    await expect(prompt).toHaveValue("partially typed")
})

test("the first overflowing result scrolls into view", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 550 })
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    const prompt = terminal.getByRole("textbox", { name: "Command" })
    await prompt.fill("help")
    await prompt.press("Enter")
    const log = terminal.getByRole("log")
    await expect(log).toContainText("The latest 20 results")
    await expect.poll(async () => log.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect.poll(async () => log.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true)
})

test("draft changes sync across tabs and stale writes need an explicit choice", async ({ page, context }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const first = page.getByRole("region", { name: "Terminal", exact: true })
    await first.getByRole("button", { name: "Build draft" }).click()
    const secondPage = await context.newPage()
    await secondPage.addInitScript(() => localStorage.setItem("memba_os_seen", "1"))
    await secondPage.goto(`${OS_ON}/os/terminal`)
    const second = secondPage.getByRole("region", { name: "Terminal", exact: true })
    await second.getByRole("button", { name: "Build draft" }).click()

    await first.getByRole("textbox", { name: "Gno source editor" }).fill("package hello\n// saved from tab A\n")
    await expect(second.getByRole("textbox", { name: "Gno source editor" })).toContainText("saved from tab A")
    await second.getByRole("textbox", { name: "Realm path" }).fill("gno.land/r/yourname/alpha")
    await expect(first.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/yourname/alpha")
    await expect(first.getByRole("textbox", { name: "Gno source editor" })).toContainText("saved from tab A")

    await secondPage.evaluate(() => {
        const key = Object.keys(localStorage).find((name) => name.startsWith("memba_os_terminal_draft:"))!
        localStorage.setItem(key, JSON.stringify({ path: "gno.land/r/yourname/alpha", source: "package alpha\n// newer draft\n" }))
    })
    await second.getByRole("textbox", { name: "Realm path" }).fill("gno.land/r/yourname/beta")
    await expect(second.getByRole("alert")).toContainText("changed in another tab")
    await expect(second.getByText("Edits in this tab are unsaved")).toBeVisible()
    await second.getByRole("button", { name: "Load other tab" }).click()
    await expect(second.getByRole("textbox", { name: "Gno source editor" })).toContainText("newer draft")
    await expect(second.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/yourname/alpha")
    await secondPage.close()
})

test("a failed local save is not erased by another tab", async ({ page, context }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const first = page.getByRole("region", { name: "Terminal", exact: true })
    await first.getByRole("button", { name: "Build draft" }).click()
    const secondPage = await context.newPage()
    await secondPage.addInitScript(() => localStorage.setItem("memba_os_seen", "1"))
    await secondPage.goto(`${OS_ON}/os/terminal`)
    const second = secondPage.getByRole("region", { name: "Terminal", exact: true })
    await second.getByRole("button", { name: "Build draft" }).click()

    await page.evaluate(() => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith("memba_os_terminal_draft:")) throw new DOMException("Storage full", "QuotaExceededError")
            return original.call(this, key, value)
        }
    })
    await first.getByRole("textbox", { name: "Gno source editor" }).fill("package hello\n// unsaved in tab A\n")
    await expect(first.getByText("Could not save locally")).toBeVisible()
    await second.getByRole("textbox", { name: "Realm path" }).fill("gno.land/r/yourname/elsewhere")
    await expect(first.getByRole("alert")).toContainText("changed in another tab")
    await expect(first.getByRole("textbox", { name: "Gno source editor" })).toContainText("unsaved in tab A")
    await secondPage.close()
})

test("reset example restores a matching path and source", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await terminal.getByRole("button", { name: "Build draft" }).click()
    await terminal.getByRole("textbox", { name: "Realm path" }).fill("gno.land/r/yourname/alpha")
    await terminal.getByRole("textbox", { name: "Gno source editor" }).fill("package alpha\n")
    page.once("dialog", (dialog) => void dialog.accept())
    await terminal.getByRole("button", { name: "Reset example" }).click()
    await expect(terminal.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/yourname/hello")
    await expect(terminal.getByRole("textbox", { name: "Gno source editor" })).toContainText("package hello")
    await expect(terminal.getByText(/The source must declare package/)).toHaveCount(0)
})

test("phone keeps the prompt visible and large drafts inside a scrollable editor", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    const prompt = terminal.getByRole("textbox", { name: "Command" })
    const dock = page.getByRole("navigation", { name: "Dock" })
    await expect(prompt).toBeVisible()
    await expect.poll(async () => {
        const input = await prompt.boundingBox()
        const dockBox = await dock.boundingBox()
        return !!input && !!dockBox && input.y + input.height <= dockBox.y
    }).toBe(true)

    await terminal.getByRole("button", { name: "Build draft" }).click()
    const editor = terminal.getByRole("textbox", { name: "Gno source editor" })
    await editor.fill(`package hello\n${"// a longer draft\n".repeat(300)}`)
    const scroller = terminal.locator(".os-terminal-editor .cm-scroller")
    const size = await scroller.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }))
    expect(size.height).toBeLessThan(400)
    expect(size.scroll).toBeGreaterThan(size.height)
})

test("Gno syntax tokens meet text contrast in both themes", async ({ page }) => {
    await page.goto(`${OS_ON}/os/terminal`)
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await terminal.getByRole("button", { name: "Build draft" }).click()
    await expect(terminal.getByRole("textbox", { name: "Gno source editor" })).toBeVisible()
    for (const theme of ["light", "dark"]) {
        const ratios = await page.evaluate((nextTheme) => {
            const root = document.querySelector<HTMLElement>(".memba-os")!
            root.dataset.osTheme = nextTheme
            const background = document.createElement("span")
            background.style.color = "var(--os-opaque)"
            root.append(background)
            const bg = getComputedStyle(background).color
            background.remove()
            const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
            const luminance = (value: string) => rgb(value).map((channel) => {
                const c = channel / 255
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
            const base = luminance(bg)
            return Array.from(document.querySelectorAll<HTMLElement>(".os-terminal-editor .cm-line span"))
                .map((span) => luminance(getComputedStyle(span).color))
                .map((foreground) => (Math.max(base, foreground) + 0.05) / (Math.min(base, foreground) + 0.05))
        }, theme)
        expect(ratios.length).toBeGreaterThan(0)
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5)
    }
})

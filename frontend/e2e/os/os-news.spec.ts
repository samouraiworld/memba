import { expect, test, type Locator, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { OS_ON } from "../../playwright.os.config"
import { abortOnchainReads } from "../helpers/onchain"
import { settleAnimations } from "./settle"

// News is a native Memba OS window: the Blog (list and one article per section)
// and the Changelogs, read as a guest. The articles are the committed ones in
// content/blog; `multisig` is one of them and links outside.
const ARTICLE = "multisig"

test.beforeEach(async ({ page }) => {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await abortOnchainReads(page)
    await page.addInitScript(() => localStorage.setItem("memba_os_skip_intro", "1"))
})

const news = (page: Page) => page.getByRole("region", { name: "News", exact: true })
const path = (page: Page) => new URL(page.url()).pathname

/** The view is on screen and styled: news.css is a lazy stylesheet, and an unstyled page proves nothing about layout. */
async function shown(win: Locator, heading: Locator) {
    await expect(heading).toBeVisible({ timeout: 30_000 })
    await expect(win.locator(".os-news")).toHaveCSS("display", "grid")
}

/** Every box from the News view up to its window that scrolls sideways (none should). */
function sideways(win: Locator): Promise<string[]> {
    return win.locator(".os-news").evaluate((root) => {
        const out: string[] = []
        for (let el: Element | null = root; el && !el.matches(".os-win, .os-ph-sheet"); el = el.parentElement) {
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.classList[0] ?? ""} +${el.scrollWidth - el.clientWidth}px`)
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push("the page itself")
        return out
    })
}

test.describe("News native window", () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }) })

    test("the list opens an article in the same window by keyboard, and the way back returns to its card", async ({ page }) => {
        await page.goto(`${OS_ON}/os/news`)
        const win = news(page)
        await shown(win, win.getByRole("heading", { level: 1, name: "Blog" }))
        const nav = win.getByRole("navigation", { name: "News" })
        await expect(nav.getByRole("button", { name: "Blog" })).toHaveAttribute("aria-current", "true")
        // The native view, not the classic page in a window; and nothing in it asks for a wallet.
        await expect(win.locator(".os-classic")).toHaveCount(0)
        await expect(win.locator(".os-wbody").getByRole("button", { name: /connect/i })).toHaveCount(0)
        expect(await win.locator(".os-news-grid > li").count()).toBeGreaterThan(1)
        await expect(win.getByRole("link", { name: /RSS feed/ })).toHaveAttribute("target", "_blank")

        const card = win.locator(`[data-article="${ARTICLE}"]`)
        const title = (await card.textContent())!.trim()
        await card.focus()
        await page.keyboard.press("Enter")
        await expect.poll(() => path(page)).toBe(`/os/news/${ARTICLE}`)
        await expect(news(page)).toHaveCount(1)
        const heading = win.getByRole("heading", { level: 1, name: title })
        await expect(heading).toBeFocused()
        await expect(nav.getByRole("button", { name: "Blog" })).toHaveAttribute("aria-current", "true")
        await expect(win.getByText(/^Published /)).toBeVisible()
        const body = win.getByTestId("news-body")
        await expect(body.locator("h2").first()).toBeVisible()
        const outside = body.locator('a[href^="https://"]').first()
        await expect(outside).toHaveAttribute("target", "_blank")
        await expect(outside).toHaveAttribute("rel", "noopener noreferrer")

        await win.getByRole("button", { name: "All articles" }).focus()
        await page.keyboard.press("Enter")
        await expect.poll(() => path(page)).toBe("/os/news")
        await expect(win.locator(`[data-article="${ARTICLE}"]`)).toBeFocused()

        // An article is a history entry: the browser's Back returns to the list, Forward to the article.
        await win.locator(`[data-article="${ARTICLE}"]`).click()
        await expect(heading).toBeVisible()
        await page.goBack()
        await expect.poll(() => path(page)).toBe("/os/news")
        await expect(win.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible()
        await page.goForward()
        await expect.poll(() => path(page)).toBe(`/os/news/${ARTICLE}`)
        await expect(heading).toBeVisible()
        await expect(news(page)).toHaveCount(1)
    })

    test("an article link carries the article in the tab title and gives the title back when the window moves on", async ({ page }) => {
        await page.goto(`${OS_ON}/os/news/${ARTICLE}`)
        const win = news(page)
        const heading = win.locator(".os-news-article > h1")
        await shown(win, heading)
        const title = (await heading.textContent())!.trim()
        await expect(page).toHaveTitle(`${title} — Memba`)
        await win.getByRole("navigation", { name: "News" }).getByRole("button", { name: "Changelogs" }).click()
        await expect.poll(() => path(page)).toBe("/os/news/changelogs")
        await expect(win.getByRole("heading", { level: 1, name: "Changelogs" })).toBeVisible()
        await expect(page).not.toHaveTitle(`${title} — Memba`)
        // The classic spelling of the address reaches the same article.
        await page.goto(`${OS_ON}/os/news/blog/${ARTICLE}`)
        await expect(news(page).getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 })
    })

    test("an article keeps the window's text styles once a classic page's markdown stylesheet is loaded", async ({ page }) => {
        await page.goto(`${OS_ON}/os/news/${ARTICLE}`)
        const win = news(page)
        await shown(win, win.locator(".os-news-article > h1"))
        const styles = () => win.locator(".os-news-body").evaluate((body) => {
            const ink = getComputedStyle(body).color
            return [...body.querySelectorAll("p, ul, ol, h1, h2, h3, h4, code, pre, table, th, td, hr, a")].map((el) => {
                const cs = getComputedStyle(el)
                return [el.tagName, cs.color === ink ? "ink" : cs.color, cs.font, cs.margin, cs.padding, cs.border, cs.backgroundColor].join(" | ")
            })
        })
        const before = await styles()
        expect(before.filter((line) => line.startsWith("P |")).length).toBeGreaterThan(2)
        // Text elements carry the window's ink (links their accent, a rule its own grey).
        for (const line of before) if (/^(P|UL|OL|H[1-4]|CODE|TABLE|TH|TD) \|/.test(line)) expect(line).toContain("| ink |")
        // The Directory's stylesheet styles the renderer's md-* classes without a scope, and stays loaded once that page was opened.
        await page.addStyleTag({ path: "src/pages/directory.css" })
        expect(await styles()).toEqual(before)
    })

    test("an unknown article says so with a way back; an address that is no News page stays with the shell", async ({ page }) => {
        await page.goto(`${OS_ON}/os/news/no-such-post`)
        const win = news(page)
        await shown(win, win.getByRole("heading", { level: 1, name: "Article not found" }))
        await expect(win.getByText("No article was found at this address.")).toBeVisible()
        await win.getByRole("button", { name: "All articles" }).click()
        await expect.poll(() => path(page)).toBe("/os/news")
        await expect(win.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible()

        await page.goto(`${OS_ON}/os/news/2026/september`)
        await expect(news(page).getByText("Nothing lives here")).toBeVisible({ timeout: 30_000 })
        await expect(news(page).getByRole("navigation", { name: "News" })).toHaveCount(0)
    })

    test("the changelog filter lives in the address, narrows the entries to its count and survives a reload", async ({ page }) => {
        await page.goto(`${OS_ON}/os/news/changelogs`)
        const win = news(page)
        await shown(win, win.getByRole("heading", { level: 1, name: "Changelogs" }))
        await expect(win.getByRole("navigation", { name: "News" }).getByRole("button", { name: "Changelogs" })).toHaveAttribute("aria-current", "true")
        const full = win.getByRole("link", { name: /Full changelog/ })
        await expect(full).toHaveAttribute("href", "https://github.com/samouraiworld/memba/blob/main/CHANGELOG.md")
        await expect(full).toHaveAttribute("target", "_blank")
        await expect(full).toHaveAttribute("rel", "noopener noreferrer")

        const filters = win.getByRole("group", { name: "Filter changelogs" })
        const entries = win.locator(".os-news-entry")
        const counted = async (chip: Locator) => Number((await chip.locator(".os-chip-n").textContent())!)
        const all = filters.getByRole("button", { name: /^All / })
        const network = filters.getByRole("button", { name: /^Network / })
        await expect(all).toHaveAttribute("aria-pressed", "true")
        await expect(entries).toHaveCount(await counted(all))
        // Current releases and the curated history are both here.
        await expect(win.getByRole("heading", { level: 3, name: /^Release v7\.7\.0$/ })).toBeVisible()
        await expect(win.getByRole("heading", { level: 3, name: /^v3\.2\.0 / })).toBeVisible()

        const some = await counted(network)
        expect(some).toBeGreaterThan(0)
        expect(some).toBeLessThan(await counted(all))
        await network.click()
        await expect.poll(() => new URL(page.url()).search).toBe("?tag=network")
        await expect(network).toHaveAttribute("aria-pressed", "true")
        await expect(entries).toHaveCount(some)
        await page.reload()
        await expect(news(page).getByRole("group", { name: "Filter changelogs" }).getByRole("button", { name: /^Network / })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 })
        await expect(news(page).locator(".os-news-entry")).toHaveCount(some)
        await news(page).getByRole("group", { name: "Filter changelogs" }).getByRole("button", { name: /^All / }).click()
        await expect.poll(() => new URL(page.url()).search).toBe("")
    })
})

test("on a phone an article opens from the list with focus on its title", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 })
    await page.goto(`${OS_ON}/os/news`)
    const win = news(page)
    await shown(win, win.getByRole("heading", { level: 1, name: "Blog" }))
    const card = win.locator(`[data-article="${ARTICLE}"]`)
    const title = (await card.textContent())!.trim()
    await card.click()
    await expect(win.getByRole("heading", { level: 1, name: title })).toBeFocused()
    await expect(win.getByRole("button", { name: "All articles" })).toBeInViewport()
})

// Light and dark, a wide window, a window near its minimum width, and the two
// phone widths the OS shows as full-height sheets. Motion is reduced throughout.
for (const view of [
    { name: "light", theme: "light", width: 1400, height: 900 },
    { name: "dark", theme: "dark", width: 1400, height: 900 },
    { name: "340px window", theme: "light", width: 1400, height: 900, windowWidth: 340 },
    { name: "phone 375", theme: "dark", width: 375, height: 760 },
    { name: "phone 320", theme: "light", width: 320, height: 700 },
] as const) {
    test(`News layout, font and accessibility · ${view.name}`, async ({ page }, testInfo) => {
        test.setTimeout(150_000)
        await page.emulateMedia({ colorScheme: view.theme, reducedMotion: "reduce" })
        await page.setViewportSize({ width: view.width, height: view.height })
        for (const [name, address, title] of [
            ["list", "/os/news", "h1"],
            ["article", `/os/news/${ARTICLE}`, ".os-news-article > h1"],
            ["changelogs", "/os/news/changelogs", "h1"],
        ] as const) {
            await page.goto(`${OS_ON}${address}`)
            const win = news(page)
            await shown(win, win.locator(`.os-news ${title}`).first())
            if ("windowWidth" in view) await win.evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px` }, view.windowWidth)
            await page.evaluate(() => document.fonts.ready)
            expect(await win.locator(".os-news").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Manrope")
            expect(await sideways(win), `${name} scrolls sideways`).toEqual([])
            await settleAnimations(page)
            const results = await new AxeBuilder({ page }).include(".memba-os").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
            expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} accessibility`).toEqual([])
            const screenshot = testInfo.outputPath(`news-${name}.png`)
            await page.screenshot({ path: screenshot })
            await testInfo.attach(`news-${view.name}-${name}`, { path: screenshot, contentType: "image/png" })
        }
    })
}

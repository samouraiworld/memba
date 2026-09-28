import { expect, test } from "@playwright/test"
import { OS_ON } from "../../playwright.os.config"

test.beforeEach(async ({ page }) => {
    await page.route(/memba\.v1\.|\.gno\.land|gnolove|plausible\.io|sentry\.|clerk[.-]|youtube/, route => route.abort())
    await page.addInitScript(() => localStorage.setItem("memba_os_seen", "1"))
})

test("Learn deep link keeps keyboard focus when the optional player mounts", async ({ page }) => {
    await page.goto(`${OS_ON}/os/learn`)
    const learn = page.getByRole("region", { name: "Learn", exact: true })
    await expect(learn.getByRole("heading", { name: "Learn to build on Gno" })).toBeVisible()
    await page.reload()
    const load = learn.getByRole("button", { name: "Load playlist" })
    await load.focus()
    await page.keyboard.press("Enter")
    const unload = learn.getByRole("button", { name: "Unload player" })
    await expect(unload).toBeFocused()
    await expect(learn.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/videoseries/)
    await unload.click()
    await expect(learn.locator("iframe")).toHaveCount(0)
    await expect(learn.getByRole("button", { name: "Load playlist" })).toBeFocused()
    await learn.getByRole("button", { name: "Open Terminal" }).click()
    await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeVisible()
})

test("Learn fits a 320 px phone and unknown sections retain the shell fallback", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto(`${OS_ON}/os/learn`)
    const learn = page.getByRole("region", { name: "Learn", exact: true })
    await expect(learn.getByRole("link", { name: /Understand package deployment/ })).toBeVisible()
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(320)
    expect(await learn.locator(".os-learn-body").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.goto(`${OS_ON}/os/learn/unknown`)
    await expect(page.getByRole("region", { name: "Learn", exact: true }).getByText("Nothing lives here")).toBeVisible()
})

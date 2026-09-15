import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ThemeSelect, ThemeToggle } from "./ThemeSelect"
import { getTheme, getThemePreference, setTheme } from "../../lib/themeStore"
afterEach(cleanup)
it("offers System/Light/Black and synchronizes mounted controls", () => {
    setTheme("system")
    const selected = vi.fn()
    render(<><ThemeSelect onSelect={selected} /><ThemeSelect /><ThemeToggle /></>)
    const [first, second] = screen.getAllByRole("combobox", { name: "Theme" })
    expect(first).toHaveValue("system")
    expect(screen.getAllByRole("option", { name: "Black" })).toHaveLength(2)
    fireEvent.change(first, { target: { value: "dark" } })
    expect(second).toHaveValue("dark")
    expect(getTheme()).toBe("dark")
    expect(selected).toHaveBeenCalledOnce()
    act(() => setTheme("light"))
    expect(first).toHaveValue("light")
    expect(second).toHaveValue("light")
    fireEvent.click(screen.getByRole("button", { name: "Switch to Black theme" }))
    expect(getThemePreference()).toBe("dark")
    expect(first).toHaveValue("dark")
    fireEvent.click(screen.getByRole("button", { name: "Switch to Light theme" }))
    expect(first).toHaveValue("light")
})

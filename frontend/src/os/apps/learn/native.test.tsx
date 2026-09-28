import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import LearnWindow from "./native"

const base = { query: undefined, close: () => {}, toast: () => {}, fallback: <p>Existing page</p>, session: {} as never, open: () => {} }

describe("Learn window", () => {
    it("keeps the video behind a choice and retains keyboard focus when it loads or unloads", () => {
        render(<LearnWindow {...base} section={null} openApp={vi.fn()} />)
        expect(screen.queryByTitle("PeerDev Gno tutorials")).not.toBeInTheDocument()
        const load = screen.getByRole("button", { name: "Load playlist" })
        expect(load).toHaveAttribute("aria-expanded", "false")
        load.focus()
        fireEvent.click(load)
        const unload = screen.getByRole("button", { name: "Unload player" })
        expect(unload).toBe(load)
        expect(unload).toHaveFocus()
        expect(unload).toHaveAttribute("aria-expanded", "true")
        expect(screen.getByTitle("PeerDev Gno tutorials")).toHaveAttribute("src", expect.stringContaining("youtube-nocookie.com/embed/videoseries"))
        fireEvent.click(unload)
        expect(screen.getByRole("button", { name: "Load playlist" })).toHaveFocus()
        expect(screen.queryByTitle("PeerDev Gno tutorials")).not.toBeInTheDocument()
    })

    it("links to the explanatory slides and discloses the local and staging examples", () => {
        const openApp = vi.fn()
        render(<LearnWindow {...base} section={null} openApp={openApp} />)
        expect(screen.getByText(/community resource/)).toHaveTextContent("local or staging chains")
        const deploy = screen.getByRole("link", { name: /Understand package deployment/ })
        const secure = screen.getByRole("link", { name: /Protect keys and review transactions/ })
        expect(deploy).toHaveAttribute("href", expect.stringContaining("short-tutorials/6-deploy-pkg/slides.md"))
        expect(secure).toHaveAttribute("href", expect.stringContaining("tutorials/8-secure-tx/slides.md"))
        expect(screen.getByText(/guide shows an older path/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }))
        expect(openApp).toHaveBeenCalledWith("terminal")
    })

    it("preserves the classic fallback for unknown sections", () => {
        render(<LearnWindow {...base} section="unknown" openApp={vi.fn()} />)
        expect(screen.getByText("Existing page")).toBeInTheDocument()
    })
})

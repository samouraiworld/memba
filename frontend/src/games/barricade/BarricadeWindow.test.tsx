import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { WindowActivityContext } from "../../os/page/WindowActivity"
vi.mock("./render/three/caps", () => ({ resolveRenderer: () => "2d" }))
import Barricade from "./Barricade"

describe("Barricade in a compact OS window", () => {
    beforeEach(() => {
        HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
        vi.stubGlobal("cancelAnimationFrame", vi.fn())
    })
    afterEach(() => vi.unstubAllGlobals())

    it("puts the start controls before the tall playfield in reading order", () => {
        render(<MemoryRouter><Barricade /></MemoryRouter>)
        const start = screen.getByRole("button", { name: "Daily run" })
        const stage = screen.getByRole("group", { name: "Barricade playfield" })
        expect(start.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("does not animate the ready screen while its OS window is parked", () => {
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({} as CanvasRenderingContext2D)
        const view = (active: boolean) => (
            <MemoryRouter><WindowActivityContext.Provider value={active}><Barricade /></WindowActivityContext.Provider></MemoryRouter>
        )
        const { rerender } = render(view(false))
        expect(requestAnimationFrame).not.toHaveBeenCalled()
        rerender(view(true))
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
        rerender(view(false))
        expect(cancelAnimationFrame).toHaveBeenCalled()
    })

    it("freezes a running simulation when its OS window becomes inactive", () => {
        const view = (active: boolean) => (
            <MemoryRouter><WindowActivityContext.Provider value={active}><Barricade /></WindowActivityContext.Provider></MemoryRouter>
        )
        const { rerender } = render(view(true))
        fireEvent.click(screen.getByRole("button", { name: "Daily run" }))
        expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument()
        rerender(view(false))
        expect(screen.getByText("Run paused")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Resume run" })).not.toHaveFocus()
    })

    it("names the run it is in: a Practice run is not called a daily run", () => {
        render(<MemoryRouter><Barricade /></MemoryRouter>)
        expect(screen.getByText("Daily run · Season 0")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Practice" }))
        expect(screen.queryByText("Daily run · Season 0")).toBeNull()
        expect(screen.getByText("Practice", { selector: ".bar-eyebrow" })).toBeInTheDocument()
    })

    it("announces a keyboard pause and focuses its Resume action", () => {
        render(<MemoryRouter><Barricade /></MemoryRouter>)
        fireEvent.click(screen.getByRole("button", { name: "Practice" }))
        const stage = screen.getByRole("group", { name: "Barricade playfield" })
        expect(stage).toHaveFocus()
        fireEvent.keyDown(stage, { key: "p" })
        expect(screen.getByRole("dialog", { name: "Run paused" })).toBeInTheDocument()
        const resume = screen.getByRole("button", { name: "Resume run" })
        expect(resume).toHaveFocus()
        fireEvent.click(resume)
        expect(stage).toHaveFocus()
    })
})

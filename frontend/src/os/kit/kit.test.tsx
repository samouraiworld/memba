import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell, ErrorState, NotOnMainnet, Table, Toggle } from "./index"

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }))

function Boom(): never {
    throw new Error("section crash")
}

const SECTIONS = [{ id: "desk", name: "Desktop" }, { id: "net", name: "Network" }]

describe("os kit", () => {
    it("AppShell marks the current section and reports a choice", () => {
        const onSelect = vi.fn()
        render(<AppShell label="Settings" sections={[{ id: "desk", name: "Desktop" }, { id: "net", name: "Network" }]} current="desk" onSelect={onSelect}>body</AppShell>)
        expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-current", "true")
        fireEvent.click(screen.getByRole("button", { name: "Network" }))
        expect(onSelect).toHaveBeenCalledWith("net")
    })
    describe("AppShell sections", () => {
        beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}) })
        afterEach(() => { vi.restoreAllMocks() })

        it("shows Loading inside the section while its content suspends, keeping the nav", async () => {
            let resolve: () => void = () => {}
            const pending = new Promise<void>((r) => { resolve = r })
            let done = false
            void pending.then(() => { done = true })
            function Slow() {
                if (!done) throw pending
                return <p>loaded section</p>
            }
            render(<AppShell label="Settings" sections={SECTIONS} current="desk" onSelect={() => {}}><Slow /></AppShell>)
            expect(screen.getByRole("status")).toHaveTextContent("Loading")
            expect(screen.getByRole("button", { name: "Network" })).toBeInTheDocument()
            await act(async () => { resolve(); await pending })
            expect(await screen.findByText("loaded section")).toBeInTheDocument()
        })

        it("keeps a crashing section to itself and clears the error when the section changes", () => {
            const { rerender } = render(<AppShell label="Settings" sections={SECTIONS} current="desk" onSelect={() => {}}><Boom /></AppShell>)
            expect(screen.getByRole("alert")).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Network" })).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Close window" })).toBeNull()
            rerender(<AppShell label="Settings" sections={SECTIONS} current="net" onSelect={() => {}}><p>network section</p></AppShell>)
            expect(screen.queryByRole("alert")).toBeNull()
            expect(screen.getByText("network section")).toBeInTheDocument()
        })
    })
    it("Table opens a row by clicking it or its first-cell button (exactly once each), and shows the empty copy", () => {
        const onRowClick = vi.fn()
        const cols = [
            { key: "n", label: "Name", render: (r: { n: string; amt: string }) => r.n },
            { key: "amt", label: "Amount", render: (r: { n: string; amt: string }) => r.amt },
        ]
        const { rerender } = render(<Table columns={cols} rows={[{ n: "a", amt: "10" }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty="Nothing here." />)
        const open = screen.getByRole("button", { name: "a" })
        fireEvent.click(screen.getByText("10"))
        expect(onRowClick).toHaveBeenCalledTimes(1)
        fireEvent.click(open)
        expect(onRowClick).toHaveBeenCalledTimes(2)
        rerender(<Table columns={cols} rows={[]} rowKey={(r) => r.n} empty="Nothing here." />)
        expect(screen.getByText("Nothing here.")).toBeInTheDocument()
    })
    it("Toggle is a switch", () => {
        const onChange = vi.fn()
        render(<Toggle checked={false} onChange={onChange} label="Sounds" />)
        fireEvent.click(screen.getByRole("switch", { name: "Sounds" }))
        expect(onChange).toHaveBeenCalledWith(true)
    })
    it("ErrorState retries", () => {
        const onRetry = vi.fn()
        render(<ErrorState message="Could not load." onRetry={onRetry} />)
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(onRetry).toHaveBeenCalled()
    })
    it("NotOnMainnet says actions stay off", () => {
        render(<NotOnMainnet what="The NFT launchpad" />)
        expect(screen.getByText(/isn't on gnoland-1 yet/)).toBeInTheDocument()
    })
})

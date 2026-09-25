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
    describe("Table", () => {
        type R = { n: string; amt: number }
        const cols = [
            { key: "n", label: "Name", render: (r: R) => r.n, sort: (a: R, b: R) => a.n.localeCompare(b.n) },
            { key: "amt", label: "Amount", align: "end" as const, render: (r: R) => String(r.amt), sort: (a: R, b: R) => a.amt - b.amt },
            { key: "act", label: "Actions", render: (r: R) => <><button type="button">Edit {r.n}</button><a href="#x">Link {r.n}</a></> },
        ]
        const ROWS: R[] = [{ n: "b", amt: 20 }, { n: "a", amt: 30 }, { n: "c", amt: 10 }]
        const names = () => screen.getAllByRole("row").slice(1).map((tr) => tr.querySelector("td")?.textContent)
        afterEach(() => { window.getSelection()?.removeAllRanges() })

        it("opens a row by clicking it or its labelled open button, exactly once each", () => {
            const onRowClick = vi.fn()
            render(<Table columns={cols} rows={ROWS} rowKey={(r) => r.n} onRowClick={onRowClick} rowLabel={(r) => `Open ${r.n}`} empty="Nothing here." />)
            fireEvent.click(screen.getByText("20"))
            expect(onRowClick).toHaveBeenCalledTimes(1)
            expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0])
            fireEvent.click(screen.getByRole("button", { name: "Open a" }))
            expect(onRowClick).toHaveBeenCalledTimes(2)
            expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1])
        })

        it("wraps only the openColumn's content in the open button", () => {
            render(<Table columns={cols} rows={ROWS} rowKey={(r) => r.n} onRowClick={() => {}} rowLabel={(r) => `Open ${r.n}`} openColumn="amt" empty="-" />)
            const open = screen.getByRole("button", { name: "Open b" })
            expect(open).toHaveTextContent(/^20$/)
            expect(open.closest("td")).toHaveAttribute("data-align", "end")
            expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(3)
        })

        it("ignores row clicks on the row's own controls and while text is selected", () => {
            const onRowClick = vi.fn()
            render(<Table columns={cols} rows={ROWS} rowKey={(r) => r.n} onRowClick={onRowClick} rowLabel={(r) => `Open ${r.n}`} empty="-" />)
            fireEvent.click(screen.getByRole("button", { name: "Edit b" }))
            fireEvent.click(screen.getByText("Link b"))
            expect(onRowClick).not.toHaveBeenCalled()
            const cell = screen.getByText("20")
            const range = document.createRange()
            range.selectNodeContents(cell)
            window.getSelection()?.addRange(range)
            fireEvent.click(cell)
            expect(onRowClick).not.toHaveBeenCalled()
            window.getSelection()?.removeAllRanges()
            fireEvent.click(cell)
            expect(onRowClick).toHaveBeenCalledTimes(1)
        })

        it("sorts by a sortable header: none, ascending, descending, none", () => {
            render(<Table columns={cols} rows={ROWS} rowKey={(r) => r.n} empty="-" />)
            const th = screen.getByRole("columnheader", { name: "Amount" })
            expect(th).toHaveAttribute("aria-sort", "none")
            expect(screen.getByRole("columnheader", { name: "Actions" })).not.toHaveAttribute("aria-sort")
            expect(names()).toEqual(["b", "a", "c"])
            const sortBtn = screen.getByRole("button", { name: "Amount" })
            fireEvent.click(sortBtn)
            expect(th).toHaveAttribute("aria-sort", "ascending")
            expect(names()).toEqual(["c", "b", "a"])
            fireEvent.click(sortBtn)
            expect(th).toHaveAttribute("aria-sort", "descending")
            expect(names()).toEqual(["a", "b", "c"])
            fireEvent.click(sortBtn)
            expect(th).toHaveAttribute("aria-sort", "none")
            expect(names()).toEqual(["b", "a", "c"])
            fireEvent.click(screen.getByRole("button", { name: "Name" }))
            expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending")
            expect(th).toHaveAttribute("aria-sort", "none")
            expect(names()).toEqual(["a", "b", "c"])
        })

        it("pages rows and goes back to page 1 when the row count changes", () => {
            const five: R[] = ["a", "b", "c", "d", "e"].map((n, i) => ({ n, amt: i }))
            const { rerender } = render(<Table columns={cols} rows={five} rowKey={(r) => r.n} pageSize={2} empty="-" />)
            expect(screen.getByText("Showing 1–2 of 5")).toBeInTheDocument()
            expect(names()).toEqual(["a", "b"])
            expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
            fireEvent.click(screen.getByRole("button", { name: "Next" }))
            fireEvent.click(screen.getByRole("button", { name: "Next" }))
            expect(screen.getByText("Showing 5–5 of 5")).toBeInTheDocument()
            expect(names()).toEqual(["e"])
            expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
            fireEvent.click(screen.getByRole("button", { name: "Previous" }))
            expect(screen.getByText("Showing 3–4 of 5")).toBeInTheDocument()
            rerender(<Table columns={cols} rows={five.slice(0, 4)} rowKey={(r) => r.n} pageSize={2} empty="-" />)
            expect(screen.getByText("Showing 1–2 of 4")).toBeInTheDocument()
            expect(names()).toEqual(["a", "b"])
        })

        it("shows the empty state in a div, so it can hold block content", () => {
            render(<Table columns={cols} rows={[]} rowKey={(r) => r.n} empty={<p>Nothing here.</p>} />)
            const empty = screen.getByText("Nothing here.")
            expect(empty.parentElement?.tagName).toBe("DIV")
            expect(screen.queryByRole("table")).toBeNull()
        })
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

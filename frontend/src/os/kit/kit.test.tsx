import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppShell, ErrorState, NotOnMainnet, Table, Toggle } from "./index"

describe("os kit", () => {
    it("AppShell marks the current section and reports a choice", () => {
        const onSelect = vi.fn()
        render(<AppShell label="Settings" sections={[{ id: "desk", name: "Desktop" }, { id: "net", name: "Network" }]} current="desk" onSelect={onSelect}>body</AppShell>)
        expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-current", "true")
        fireEvent.click(screen.getByRole("button", { name: "Network" }))
        expect(onSelect).toHaveBeenCalledWith("net")
    })
    it("Table opens a row by click and by Enter, and shows the empty copy", () => {
        const onRowClick = vi.fn()
        const cols = [{ key: "n", label: "Name", render: (r: { n: string }) => r.n }]
        const { rerender } = render(<Table columns={cols} rows={[{ n: "a" }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty="Nothing here." />)
        fireEvent.click(screen.getByText("a"))
        fireEvent.keyDown(screen.getByText("a").closest("tr")!, { key: "Enter" })
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

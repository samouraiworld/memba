import { StrictMode, useEffect, useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { ResponsiveShell } from "./ResponsiveShell"

vi.mock("./Sidebar", () => ({ Sidebar: () => <nav data-testid="sidebar">Sidebar</nav> }))

it("keeps route state and DOM while removing mobile sidebar chrome across both rotations", () => {
    const disposed = vi.fn()
    function Run() {
        const [score, setScore] = useState(10)
        useEffect(() => disposed, [])
        return <button onClick={() => setScore(score + 1)}>score {score}</button>
    }
    const at = (mobile: boolean) => <StrictMode><ResponsiveShell mobile={mobile} connected={false} address={null}
        unvotedCount={0} notifUnreadCount={0} collapsed={false} onToggleCollapse={() => {}}><Run /></ResponsiveShell></StrictMode>
    const view = render(at(true))
    const run = screen.getByRole("button", { name: "score 10" })
    fireEvent.click(run)
    const initialDisposals = disposed.mock.calls.length // StrictMode's initial cleanup is expected.
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument()
    for (const mobile of [false, true, false, true]) {
        view.rerender(at(mobile))
        expect(screen.getByRole("button", { name: "score 11" })).toBe(run)
        expect(disposed).toHaveBeenCalledTimes(initialDisposals)
        if (mobile) expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument()
        else expect(screen.getByTestId("sidebar")).toBeVisible()
    }
})

/**
 * GnoloveNotablePRs — board + view tablist keyboard wiring.
 *
 * First test file for this page; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * these pin that both of this page's tablists are wired through the hook. The
 * view toggle also GAINED tab roles here: its buttons sat in a role=tablist
 * with no role=tab / aria-selected at all, so screen readers saw plain buttons
 * in an empty tablist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("../../hooks/gnolove", async () => {
    const actual = await vi.importActual<typeof import("../../hooks/gnolove")>("../../hooks/gnolove")
    return {
        ...actual,
        useNotablePRs: vi.fn(),
        useBoards: vi.fn(),
    }
})

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test12",
    useNetworkNav: () => () => {},
    useNetworkPath: () => (p: string) => `/test12/${p}`,
}))

import GnoloveNotablePRs from "./GnoloveNotablePRs"
import { useNotablePRs, useBoards } from "../../hooks/gnolove"

const BOARDS = [
    { id: "notable", label: "Notable", number: 66, areas: [], statuses: [] },
    { id: "other", label: "Other board", number: 67, areas: [], statuses: [] },
]

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/test12/gnolove/notable"]}>
            <GnoloveNotablePRs />
        </MemoryRouter>,
    )
}

beforeEach(() => {
    vi.mocked(useNotablePRs).mockReturnValue({ data: [], isLoading: false, isError: false } as never)
    vi.mocked(useBoards).mockReturnValue({ data: BOARDS, isLoading: false, isError: false } as never)
})

describe("GnoloveNotablePRs — tablist keyboard (APG)", () => {
    it("the view toggle's buttons are real tabs with a roving tabindex", () => {
        renderPage()
        const viewList = screen.getByRole("tablist", { name: "View" })
        const list = within(viewList).getByRole("tab", { name: /list/i })
        const board = within(viewList).getByRole("tab", { name: /board/i })
        expect(list).toHaveAttribute("aria-selected", "true")
        expect(list).toHaveAttribute("tabindex", "0")
        expect(board).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight on the view toggle moves List → Board", () => {
        renderPage()
        const viewList = screen.getByRole("tablist", { name: "View" })
        fireEvent.keyDown(within(viewList).getByRole("tab", { name: /list/i }), { key: "ArrowRight" })
        const board = within(viewList).getByRole("tab", { name: /board/i })
        expect(board).toHaveAttribute("aria-selected", "true")
        expect(board).toHaveAttribute("tabindex", "0")
    })

    it("ArrowRight on the board selector moves to the next board", () => {
        renderPage()
        const boardList = screen.getByRole("tablist", { name: "Board" })
        const notable = within(boardList).getByRole("tab", { name: "Notable" })
        expect(notable).toHaveAttribute("aria-selected", "true")

        fireEvent.keyDown(notable, { key: "ArrowRight" })
        const other = within(boardList).getByRole("tab", { name: "Other board" })
        expect(other).toHaveAttribute("aria-selected", "true")
        expect(other).toHaveAttribute("tabindex", "0")
    })
})

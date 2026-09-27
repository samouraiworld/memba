import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useRecentActivity } from "../../../hooks/home/useRecentActivity"
import { useNow } from "../../../hooks/home/useNow"
import type { NativeViewProps } from "../../native/types"
import { LiveTicker } from "./LiveTicker"
import LiveWindow from "./native"

vi.mock("../../../hooks/home/useRecentActivity", () => ({ useRecentActivity: vi.fn() }))
vi.mock("../../../hooks/home/useNow", () => ({ useNow: vi.fn() }))

const mockActivity = vi.mocked(useRecentActivity)
const now = Date.parse("2026-09-27T12:00:00Z")
const refetch = vi.fn()
const session = { network: { key: "mainnet", chainId: "gnoland1" } } as NativeViewProps["session"]
const props = { section: null, session, fallback: <span>Fallback</span> } as NativeViewProps

function set(overrides: Partial<ReturnType<typeof useRecentActivity>>) {
    mockActivity.mockReturnValue({ items: [], loading: false, error: false, available: true, updatedAt: now, refetch, ...overrides })
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNow).mockReturnValue(now)
    set({})
})

describe("Live activity", () => {
    it("shows distinct unavailable, loading, error and empty states", () => {
        set({ available: false })
        const view = render(<LiveWindow {...props} />)
        expect(screen.getByText(/Activity is unavailable on this network/)).toBeInTheDocument()

        set({ loading: true })
        view.rerender(<LiveWindow {...props} />)
        expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading recent indexed transactions")

        set({ error: true })
        view.rerender(<LiveWindow {...props} />)
        expect(screen.getByRole("alert")).toHaveTextContent("Could not load recent activity")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(refetch).toHaveBeenCalledTimes(1)

        set({})
        view.rerender(<LiveWindow {...props} />)
        expect(screen.getByText(/No transactions appeared in the recent indexed sample/)).toBeInTheDocument()
    })

    it("shows an indexed transaction and opens Live from the ticker", () => {
        set({ items: [{ kind: "governance", title: "Voted on governance", actor: "g1someone", txHash: "a".repeat(64), blockHeight: 123, time: "2026-09-27T11:59:00Z", extraCount: 0 }] })
        render(<LiveWindow {...props} />)
        expect(screen.getByText("Voted on governance")).toBeInTheDocument()
        expect(screen.getByText("Block 123")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /Transaction/ })).toHaveAttribute("href", `https://gnoscan.io/transactions/details?txhash=${"a".repeat(64)}&chainId=gnoland1`)

        const onOpen = vi.fn()
        render(<LiveTicker networkKey="mainnet" onOpen={onOpen} />)
        fireEvent.click(screen.getByRole("button", { name: /Open Live activity/ }))
        expect(onOpen).toHaveBeenCalledTimes(1)
    })
})

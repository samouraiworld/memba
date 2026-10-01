import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useRecentActivity } from "../../../hooks/home/useRecentActivity"
import { useChainHealth } from "../../../hooks/home/useChainHealth"
import { useNow } from "../../../hooks/home/useNow"
import type { NativeViewProps } from "../../native/types"
import { LiveTicker } from "./LiveTicker"
import { LiveActivityProvider } from "./LiveProvider"
import LiveWindow from "./native"

vi.mock("../../../hooks/home/useRecentActivity", () => ({ useRecentActivity: vi.fn() }))
vi.mock("../../../hooks/home/useChainHealth", () => ({ useChainHealth: vi.fn() }))
vi.mock("../../../hooks/home/useNow", () => ({ useNow: vi.fn() }))

const mockActivity = vi.mocked(useRecentActivity)
const now = Date.parse("2026-09-27T12:00:00Z")
const refetch = vi.fn()
const session = { network: { key: "mainnet", chainId: "gnoland-1" } } as NativeViewProps["session"]
const props = { section: null, session, fallback: <span>Fallback</span> } as NativeViewProps
const live = (children: ReactNode) => <LiveActivityProvider networkKey="mainnet" active>{children}</LiveActivityProvider>

function set(overrides: Partial<ReturnType<typeof useRecentActivity>>) {
    mockActivity.mockReturnValue({ items: [], loading: false, error: false, available: true, updatedAt: now, refetch, ...overrides })
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNow).mockReturnValue(now)
    vi.mocked(useChainHealth).mockReturnValue({ degraded: false, health: "healthy", blockAge: 0, loading: false })
    set({})
})

describe("Live activity", () => {
    it("shows distinct unavailable, loading, error and empty states", () => {
        set({ available: false })
        const view = render(live(<LiveWindow {...props} />))
        expect(screen.getByText(/Activity is unavailable on this network/)).toBeInTheDocument()

        set({ loading: true })
        view.rerender(live(<LiveWindow {...props} />))
        expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading recent indexed transactions")

        set({ error: true })
        view.rerender(live(<LiveWindow {...props} />))
        expect(screen.getByRole("alert")).toHaveTextContent("Could not load recent activity")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(refetch).toHaveBeenCalledTimes(1)

        set({})
        view.rerender(live(<LiveWindow {...props} />))
        expect(screen.getByText(/No transactions appeared in the recent indexed sample/)).toBeInTheDocument()
    })

    it("shows an indexed transaction and opens Live from the ticker", () => {
        set({ items: [{ kind: "governance", title: "Voted on governance", actor: "g1someone", txHash: "a".repeat(64), blockHeight: 123, time: "2026-09-27T11:59:00Z", extraCount: 0, msgIndex: 0 }] })
        const onOpen = vi.fn()
        render(live(<><LiveWindow {...props} /><LiveTicker onOpen={onOpen} /></>))
        expect(screen.getAllByText("Voted on governance")).toHaveLength(2)
        expect(screen.getByText("Block 123")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /Transaction/ })).toHaveAttribute("href", `https://gnoscan.io/transactions/details?txhash=${"a".repeat(64)}&chainId=gnoland-1`)
        fireEvent.click(screen.getByRole("button", { name: /Open Live activity/ }))
        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(mockActivity).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("button", { name: /Open Live activity/ })).toHaveAccessibleName(/Last transaction 1m ago/)
    })

    it("labels a halted chain as paused even when the indexer returns data", () => {
        vi.mocked(useChainHealth).mockReturnValue({ degraded: true, health: "halted", blockAge: 500, loading: false })
        set({ items: [{ kind: "post", title: "Posted on the feed", actor: "g1someone", txHash: "b".repeat(64), blockHeight: 120, extraCount: 0, msgIndex: 0 }] })
        render(live(<><LiveWindow {...props} /><LiveTicker onOpen={vi.fn()} /></>))
        expect(screen.getByText(/Chain activity appears paused/)).toBeInTheDocument()
        const ticker = screen.getByRole("button", { name: /activity paused/ })
        expect(ticker).toHaveAttribute("data-state", "paused")
        expect(ticker).not.toHaveTextContent("Last transaction")
    })

    it("distinguishes an old sampled transaction from a fresh relay check", () => {
        set({ items: [{ kind: "post", title: "Posted on the feed", actor: "g1someone", txHash: "c".repeat(64), blockHeight: 111, time: "2026-09-25T12:00:00Z", extraCount: 0, msgIndex: 0 }] })
        render(live(<><LiveWindow {...props} /><LiveTicker onOpen={vi.fn()} /></>))
        expect(screen.getByText(/Indexer checked just now · latest sampled transaction 2d ago/)).toBeInTheDocument()
        expect(screen.getByText(/Indexer tip freshness is not independently verified/)).toBeInTheDocument()
        const ticker = screen.getByRole("button", { name: /Last transaction 2d ago/ })
        expect(ticker).toHaveAttribute("data-state", "ready")
        expect(ticker).toHaveTextContent("Last transaction 2d ago")
    })
})

/**
 * ActivityFeed — state coverage (loading / error / empty / ready), honest
 * rendering, and the relativeActivityTime helper. The data hook is mocked at
 * the module boundary; everything else is the real component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import type { ActivityItem } from "../../lib/activity"

vi.mock("../../hooks/home/useRecentActivity", () => ({ useRecentActivity: vi.fn() }))

const { useRecentActivity } = await import("../../hooks/home/useRecentActivity")
const { ActivityFeed } = await import("./ActivityFeed")
const { relativeActivityTime } = await import("../../lib/activity")

const mockHook = vi.mocked(useRecentActivity)

const item = (over: Partial<ActivityItem>): ActivityItem => ({
    kind: "call", title: "Approve · gnoswap/gns", actor: "g1abcabcabcabcabcabcabcabcabcabcabcabcabc",
    pkgPath: "gno.land/r/gnoswap/gns", func: "Approve", txHash: "h1", blockHeight: 100, extraCount: 0, ...over,
})

const set = (over: Partial<ReturnType<typeof useRecentActivity>>) =>
    mockHook.mockReturnValue({ items: [], loading: false, error: false, available: true, refetch: vi.fn(), ...over })

beforeEach(() => mockHook.mockReset())

describe("ActivityFeed", () => {
    it("renders nothing when no indexer is available for the network", () => {
        set({ available: false })
        const { container } = render(<ActivityFeed networkKey="test13" />)
        expect(container.firstChild).toBeNull()
    })

    it("shows skeletons while loading", () => {
        set({ loading: true })
        const { container } = render(<ActivityFeed networkKey="test13" />)
        expect(container.querySelectorAll(".activity-feed__row--skeleton").length).toBeGreaterThan(0)
        expect(screen.queryByTestId("activity-feed-list")).toBeNull()
    })

    it("shows an error state with a working retry button", () => {
        const refetch = vi.fn()
        set({ error: true, refetch })
        render(<ActivityFeed networkKey="test13" />)
        expect(screen.getByTestId("activity-feed-error")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /retry/i }))
        expect(refetch).toHaveBeenCalledTimes(1)
    })

    it("shows an honest empty state (never fabricates rows) when the window is empty", () => {
        set({ items: [] })
        render(<ActivityFeed networkKey="test13" />)
        expect(screen.getByTestId("activity-feed-empty")).toBeInTheDocument()
        expect(screen.queryByTestId("activity-feed-list")).toBeNull()
    })

    it("renders a row per item with a gnoweb realm link when a pkgPath is present", () => {
        set({ items: [item({ txHash: "h1", title: "Approve · gnoswap/gns" })] })
        render(<ActivityFeed networkKey="test13" />)
        const rows = screen.getAllByTestId("activity-row")
        expect(rows).toHaveLength(1)
        const link = within(rows[0]).getByRole("link")
        expect(link.getAttribute("href")).toContain("/r/gnoswap/gns")
        expect(link.getAttribute("target")).toBe("_blank")
    })

    it("renders a non-link row for an item without a pkgPath (e.g. a transfer)", () => {
        set({ items: [item({ kind: "transfer", title: "Sent 1000000ugnot", pkgPath: undefined, txHash: "h2" })] })
        render(<ActivityFeed networkKey="test13" />)
        expect(screen.queryByRole("link")).toBeNull()
        expect(screen.getByText("Sent 1000000ugnot")).toBeInTheDocument()
    })

    it("surfaces the extra-message count", () => {
        set({ items: [item({ extraCount: 2, txHash: "h3" })] })
        render(<ActivityFeed networkKey="test13" />)
        expect(screen.getByText(/\+2 more/)).toBeInTheDocument()
    })
})

describe("relativeActivityTime", () => {
    const now = Date.parse("2026-06-25T12:00:00Z")
    it("returns '' for missing or unparseable input", () => {
        expect(relativeActivityTime(undefined, now)).toBe("")
        expect(relativeActivityTime("not-a-date", now)).toBe("")
    })
    it("buckets recent → just now / minutes / hours / days", () => {
        expect(relativeActivityTime("2026-06-25T11:59:40Z", now)).toBe("just now")
        expect(relativeActivityTime("2026-06-25T11:55:00Z", now)).toBe("5m")
        expect(relativeActivityTime("2026-06-25T09:00:00Z", now)).toBe("3h")
        expect(relativeActivityTime("2026-06-23T12:00:00Z", now)).toBe("2d")
    })
})

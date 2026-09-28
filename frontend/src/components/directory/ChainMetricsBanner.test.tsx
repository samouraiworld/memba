import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ChainMetricsBanner } from "./ChainMetricsBanner"
import { getNetworkStats } from "../../lib/validators"

vi.mock("../../lib/validators", () => ({ getNetworkStats: vi.fn() }))

const stats = {
    blockHeight: 1234,
    totalValidators: 12,
    avgBlockTime: 5.5,
    chainId: "gnoland-1",
}

let visible = true
let originalVisibility: PropertyDescriptor | undefined

beforeEach(() => {
    vi.clearAllMocks()
    visible = true
    originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState")
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" })
})

afterEach(() => {
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility)
    else Reflect.deleteProperty(document, "visibilityState")
})

describe("ChainMetricsBanner", () => {
    it("marks retained metrics stale after a failed refresh and recovers on retry", async () => {
        vi.mocked(getNetworkStats)
            .mockResolvedValueOnce(stats as Awaited<ReturnType<typeof getNetworkStats>>)
            .mockRejectedValueOnce(new Error("RPC unavailable"))
            .mockResolvedValueOnce({ ...stats, blockHeight: 1235 } as Awaited<ReturnType<typeof getNetworkStats>>)

        render(<ChainMetricsBanner />)
        expect(await screen.findByText("1,234")).toBeInTheDocument()
        expect(screen.getByTitle(/Latest check succeeded/)).toBeInTheDocument()

        fireEvent(document, new Event("visibilitychange"))
        expect(await screen.findByText(/Stale · last checked .* UTC\. Refresh failed\./)).toBeInTheDocument()
        expect(screen.getByText("1,234")).toBeInTheDocument()
        expect(screen.queryByTitle(/Latest check succeeded/)).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("1,235")).toBeInTheDocument()
        expect(screen.queryByText(/Stale/)).not.toBeInTheDocument()
    })

    it("does not overlap reads and refreshes when a hidden page becomes visible", async () => {
        let release!: (value: Awaited<ReturnType<typeof getNetworkStats>>) => void
        vi.mocked(getNetworkStats)
            .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
            .mockResolvedValue(stats as Awaited<ReturnType<typeof getNetworkStats>>)

        render(<ChainMetricsBanner />)
        expect(getNetworkStats).toHaveBeenCalledTimes(1)
        visible = false
        fireEvent(document, new Event("visibilitychange"))
        visible = true
        fireEvent(document, new Event("visibilitychange"))
        fireEvent(document, new Event("visibilitychange"))
        expect(getNetworkStats).toHaveBeenCalledTimes(1)

        release(stats as Awaited<ReturnType<typeof getNetworkStats>>)
        await waitFor(() => expect(getNetworkStats).toHaveBeenCalledTimes(2))
        expect(await screen.findByText("1,234")).toBeInTheDocument()
    })

    it("shows a visible failure and retry when the first read fails", async () => {
        vi.mocked(getNetworkStats).mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(stats as Awaited<ReturnType<typeof getNetworkStats>>)
        render(<ChainMetricsBanner />)
        expect(await screen.findByText(/Chain metrics unavailable/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("1,234")).toBeInTheDocument()
    })
})

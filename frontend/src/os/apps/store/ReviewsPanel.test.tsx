import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const available = vi.hoisted(() => ({ value: true }))
const captured = vi.hoisted(() => ({ act: null as null | ((action: never) => Promise<boolean>) }))
const sign = vi.hoisted(() => vi.fn())
const gasPrice = vi.hoisted(() => vi.fn())
const buildRequest = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isAppReviewsAvailable: () => available.value }))
vi.mock("../../../components/reviews/ReviewsSection", () => ({
    ReviewsSection: ({ subject, os }: { subject: string; os: { act: (action: never) => Promise<boolean> } }) => { captured.act = os.act; return <p>list of {subject}</p> },
}))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: gasPrice }))
vi.mock("./reviewActionRequest", () => ({ reviewActionRequest: buildRequest }))
vi.mock("./NativeReviewComposer", () => ({ NativeReviewComposer: ({ subject }: { subject: string }) => <p>composer for {subject}</p> }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign }) }))

import { ReviewsPanel } from "./ReviewsPanel"

const openConnect = vi.fn()
const session = { network: { key: "mainnet", chainId: "gnoland-1" }, status: "guest", openConnect } as never
const member = { network: { key: "mainnet", chainId: "gnoland-1" }, status: "member", address: "g1member", openConnect } as never
const action = { kind: "flag" } as never
const price = { gas: 1000, ugnot: 1 }
const sentinel = { sentinel: true }

beforeEach(() => { vi.clearAllMocks(); captured.act = null; buildRequest.mockReturnValue(sentinel) })

describe("ReviewsPanel", () => {
    it("lists reviews for a subject and offers the composer only when composable", () => {
        const { rerender } = render(<ReviewsPanel subject="memba:app/adena" name="Adena" session={session} composable />)
        expect(screen.getByText("list of memba:app/adena")).toBeInTheDocument()
        expect(screen.getByText("composer for memba:app/adena")).toBeInTheDocument()
        rerender(<ReviewsPanel subject="memba:app/adena" name="Adena" session={session} composable={false} />)
        expect(screen.queryByText(/composer for/)).not.toBeInTheDocument()
    })
    it("says so when reviews are not available", () => {
        available.value = false
        render(<ReviewsPanel subject="x" name="X" session={session} composable />)
        expect(screen.getByText("Onchain reviews are not available here yet.")).toBeInTheDocument()
        available.value = true
    })
    describe("review actions", () => {
        it("sends a guest to connect and signs nothing", async () => {
            render(<ReviewsPanel subject="memba:app/adena" name="Adena" session={session} composable />)
            await expect(captured.act!(action)).resolves.toBe(false)
            expect(openConnect).toHaveBeenCalledTimes(1)
            expect(gasPrice).not.toHaveBeenCalled()
            expect(sign).not.toHaveBeenCalled()
        })
        it("quotes the fee at the click and hands a member the signing sheet", async () => {
            gasPrice.mockResolvedValue(price)
            render(<ReviewsPanel subject="memba:app/adena" name="Adena" session={member} composable />)
            await expect(captured.act!(action)).resolves.toBe(false)
            expect(gasPrice).toHaveBeenCalledTimes(1)
            expect(buildRequest).toHaveBeenCalledWith(expect.objectContaining({ action, appName: "Adena", caller: "g1member", networkKey: "mainnet", chainId: "gnoland-1", price }))
            expect(sign).toHaveBeenCalledTimes(1)
            expect(sign).toHaveBeenCalledWith(sentinel)
            expect(openConnect).not.toHaveBeenCalled()
        })
        it("rejects with a plain message when the fee cannot be read, and signs nothing", async () => {
            gasPrice.mockRejectedValue(new Error("rpc down"))
            render(<ReviewsPanel subject="memba:app/adena" name="Adena" session={member} composable />)
            await expect(captured.act!(action)).rejects.toThrow("The network fee could not be read. Try again in a moment.")
            expect(sign).not.toHaveBeenCalled()
        })
    })
})

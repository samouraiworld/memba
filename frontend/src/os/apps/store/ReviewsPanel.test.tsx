import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const available = vi.hoisted(() => ({ value: true }))
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isAppReviewsAvailable: () => available.value }))
vi.mock("../../../components/reviews/ReviewsSection", () => ({ ReviewsSection: ({ subject }: { subject: string }) => <p>list of {subject}</p> }))
vi.mock("./NativeReviewComposer", () => ({ NativeReviewComposer: ({ subject }: { subject: string }) => <p>composer for {subject}</p> }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign: vi.fn() }) }))

import { ReviewsPanel } from "./ReviewsPanel"

const session = { network: { key: "mainnet", chainId: "gnoland-1" }, status: "guest", openConnect: vi.fn() } as never

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
})

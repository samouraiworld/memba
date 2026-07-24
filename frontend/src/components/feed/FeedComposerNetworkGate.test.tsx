/**
 * FeedComposer — the network gate.
 *
 * The feed realm path is the same on every network Memba allowlists it on, but
 * the backend indexes exactly one chain. On any other network a post succeeds
 * on-chain, costs gas, and is invisible in the product forever. The composer
 * must say so instead of inviting the post.
 *
 * Separate file from FeedComposer.test.tsx because it needs a different
 * lib/config mock, and vi.mock is hoisted per-module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const writable = vi.fn(() => false)
const switchNetwork = vi.fn()

vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isFeedWritable: () => writable(),
    FEED_INDEXED_NETWORK: "test13",
}))
vi.mock("../../hooks/useNetwork", () => ({ useNetwork: () => ({ switchNetwork }) }))
vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildCreatePostMsg: vi.fn(() => ({})),
    FEED_INDEXED_NETWORK_LABEL: "Testnet 13",
}))

const { submitFeedMsg } = await import("../../lib/feed")
const { FeedComposer } = await import("./FeedComposer")
const mockSubmit = vi.mocked(submitFeedMsg)

beforeEach(() => {
    mockSubmit.mockReset()
    switchNetwork.mockReset()
    writable.mockReturnValue(false)
})

const props = {
    connected: true,
    address: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    onConnect: () => {},
    onPosted: () => {},
}

describe("FeedComposer network gate", () => {
    it("replaces the input with an explanation on a non-indexed network", () => {
        render(<FeedComposer {...props} />)
        // The composer must not invite a post that cannot succeed.
        expect(screen.queryByTestId("feed-composer-input")).toBeNull()
        expect(screen.queryByTestId("feed-post-btn")).toBeNull()
        expect(screen.getByTestId("feed-composer-network-gate")).toHaveTextContent(/Testnet 13/)
    })

    it("offers a one-click switch to the indexed network", () => {
        render(<FeedComposer {...props} />)
        fireEvent.click(screen.getByTestId("feed-composer-switch-btn"))
        expect(switchNetwork).toHaveBeenCalledWith("test13")
    })

    it("renders the normal composer on the indexed network", () => {
        writable.mockReturnValue(true)
        render(<FeedComposer {...props} />)
        expect(screen.getByTestId("feed-composer-input")).toBeInTheDocument()
        expect(screen.queryByTestId("feed-composer-network-gate")).toBeNull()
    })
})

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TxStatus } from "./TxStatus"

const HASH = "a".repeat(64)

describe("TxStatus", () => {
    it("renders nothing while idle", () => {
        const { container } = render(<TxStatus state={{ phase: "idle" }} />)
        expect(container).toBeEmptyDOMElement()
    })

    it("walks through wallet, block and confirmed", () => {
        const { rerender } = render(<TxStatus state={{ phase: "wallet" }} chainId="pearl-1" />)
        expect(screen.getByRole("status")).toHaveTextContent("Approve the transaction in your wallet")
        rerender(<TxStatus state={{ phase: "block", hash: HASH }} chainId="pearl-1" />)
        expect(screen.getByRole("status")).toHaveTextContent("Waiting for the block")
        rerender(<TxStatus state={{ phase: "confirmed", hash: HASH, message: "Vote recorded." }} chainId="pearl-1" />)
        expect(screen.getByRole("status")).toHaveTextContent("ConfirmedVote recorded.")
        expect(screen.getByRole("link", { name: HASH })).toHaveAttribute("href", expect.stringContaining(`txhash=${HASH}`))
    })

    it("shows a copyable hash without a link where no explorer indexes the chain", () => {
        render(<TxStatus state={{ phase: "confirmed", hash: HASH, message: "Done." }} chainId="gnoland-1" />)
        expect(screen.queryByRole("link")).not.toBeInTheDocument()
        expect(screen.getByTitle("Transaction hash")).toHaveTextContent(HASH)
    })

    it("announces failures as alerts", () => {
        render(<TxStatus state={{ phase: "failed", message: "You already voted on this proposal. Votes are final." }} />)
        expect(screen.getByRole("alert")).toHaveTextContent("You already voted")
    })
})

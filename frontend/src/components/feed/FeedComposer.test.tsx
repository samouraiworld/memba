/**
 * FeedComposer — permanence disclosure. Posting writes to an immutable chain;
 * "delete" only hides the projection, the body stays on-chain forever. The
 * composer must disclose this so the honesty contract is real (a connected user
 * about to post sees that it's public + permanent).
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { FeedComposer } from "./FeedComposer"

const noop = () => {}

describe("FeedComposer permanence disclosure", () => {
    it("discloses that posts are public and permanent on-chain when connected", () => {
        render(
            <FeedComposer
                connected={true}
                address="g1abcabcabcabcabcabcabcabcabcabcabcabcabc"
                onConnect={noop}
                onPosted={noop}
            />,
        )
        expect(screen.getByText(/permanent/i)).toBeInTheDocument()
        expect(screen.getByText(/on-chain|public/i)).toBeInTheDocument()
    })
})

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PostUnfurls } from "./PostUnfurls"

describe("PostUnfurls", () => {
    it("renders a realm card for a gno.land realm reference", () => {
        render(<PostUnfurls body="vote on r/samcrew/memba_feed_v1 now" />)
        const card = screen.getByTestId("feed-unfurl-realm")
        expect(card).toHaveAttribute("href", "https://gno.land/r/samcrew/memba_feed_v1")
        expect(card).toHaveTextContent("memba_feed_v1")
        expect(card).toHaveTextContent("r/samcrew")
    })

    it("renders a link card (with host) for a plain URL", () => {
        render(<PostUnfurls body="see https://example.com/post" />)
        const card = screen.getByTestId("feed-unfurl-link")
        expect(card).toHaveAttribute("href", "https://example.com/post")
        expect(card).toHaveTextContent("example.com")
    })

    it("renders nothing for a body with no references", () => {
        const { container } = render(<PostUnfurls body="a plain thought" />)
        expect(container.firstChild).toBeNull()
    })

    it("opens links safely in a new tab", () => {
        render(<PostUnfurls body="r/gno/land" />)
        const card = screen.getByTestId("feed-unfurl-realm")
        expect(card).toHaveAttribute("target", "_blank")
        expect(card).toHaveAttribute("rel", "noopener noreferrer")
    })
})

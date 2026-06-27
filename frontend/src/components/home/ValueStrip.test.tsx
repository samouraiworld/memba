/**
 * ValueStrip — the visitor on-ramp: three goal-framed cards linking to existing
 * destinations, in plain human verbs (not blockchain nouns).
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ValueStrip } from "./ValueStrip"

const renderIt = () => render(<MemoryRouter><ValueStrip networkKey="test13" /></MemoryRouter>)

describe("ValueStrip", () => {
    it("renders three human-verb cards linking to the right destinations", () => {
        renderIt()
        expect(screen.getByRole("link", { name: /join a community and vote/i })).toHaveAttribute("href", "/test13/dao")
        expect(screen.getByRole("link", { name: /launch a token/i })).toHaveAttribute("href", "/test13/tokens")
        expect(screen.getByRole("link", { name: /track the network/i })).toHaveAttribute("href", "/test13/validators")
    })

    it("is labelled for assistive tech", () => {
        renderIt()
        expect(screen.getByRole("region", { name: /what you can do here/i })).toBeInTheDocument()
    })
})

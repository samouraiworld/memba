/**
 * ValueStrip — the visitor on-ramp: three goal-framed cards linking to existing
 * destinations, in plain human verbs (not blockchain nouns).
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ValueStrip } from "./ValueStrip"

const renderIt = (networkKey = "pearl") => render(<MemoryRouter><ValueStrip networkKey={networkKey} /></MemoryRouter>)

describe("ValueStrip", () => {
    it("renders three human-verb cards linking to the right destinations", () => {
        renderIt()
        expect(screen.getByRole("link", { name: /explore daos/i })).toHaveAttribute("href", "/pearl/dao")
        expect(screen.getByRole("link", { name: /launch a token/i })).toHaveAttribute("href", "/pearl/tokens")
        expect(screen.getByRole("link", { name: /track the network/i })).toHaveAttribute("href", "/pearl/validators")
    })

    it("labels the unavailable token launchpad on mainnet", () => {
        renderIt("mainnet")
        expect(screen.getByRole("link", { name: /token launchpad.*Memba token creation unavailable here/i })).toHaveAttribute("href", "/mainnet/tokens")
        expect(screen.queryByText(/launch a token/i)).not.toBeInTheDocument()
    })

    it("is labelled for assistive tech", () => {
        renderIt()
        expect(screen.getByRole("region", { name: /what you can do here/i })).toBeInTheDocument()
    })
})

/**
 * ValueStrip — the visitor on-ramp: three goal-framed cards linking to existing
 * destinations, in plain human verbs (not blockchain nouns).
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ValueStrip } from "./ValueStrip"

const renderIt = (networkKey = "test13") => render(<MemoryRouter><ValueStrip networkKey={networkKey} /></MemoryRouter>)

describe("ValueStrip", () => {
    it("renders three human-verb cards linking to the right destinations", () => {
        renderIt()
        expect(screen.getByRole("link", { name: /explore daos/i })).toHaveAttribute("href", "/test13/dao")
        expect(screen.getByRole("link", { name: /launch a token/i })).toHaveAttribute("href", "/test13/tokens")
        expect(screen.getByRole("link", { name: /track the network/i })).toHaveAttribute("href", "/test13/validators")
    })

    it("offers token creation on mainnet, where the Launchpad is listed", () => {
        renderIt("mainnet")
        expect(screen.getByRole("link", { name: /launch a token/i })).toHaveAttribute("href", "/mainnet/tokens")
    })

    it("labels the token launchpad unavailable where neither the Launchpad nor the factory is listed", () => {
        renderIt("elsewhere")
        expect(screen.getByRole("link", { name: /token launchpad.*Memba token creation unavailable here/i })).toHaveAttribute("href", "/elsewhere/tokens")
        expect(screen.queryByText(/launch a token/i)).not.toBeInTheDocument()
    })

    it("is labelled for assistive tech", () => {
        renderIt()
        expect(screen.getByRole("region", { name: /what you can do here/i })).toBeInTheDocument()
    })
})

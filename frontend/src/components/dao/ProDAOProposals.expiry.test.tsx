import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { DAOProposal } from "../../lib/dao"
import { ProDAOProposals } from "./ProDAOProposals"

vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkPath: () => (path: string) => `/test13/${path}` }))

describe("professional proposal list expiry", () => {
    it.each([ ["expired", "Expired"], ["invalidated", "Membership changed"] ] as const)("keeps %s proposals in history and out of actionable filters", (status, label) => {
        const expired = { id: 7, title: "Expired decision", author: "founder", status } as DAOProposal
        render(<MemoryRouter><ProDAOProposals encodedSlug="example" proposals={[expired]} loading={false} failed={false} retry={vi.fn()} canPropose={false} votedIds={new Set()} /></MemoryRouter>)
        expect(screen.getByText(label, { exact: true })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /^History/ }))
        expect(screen.getByRole("link", { name: /Expired decision/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /^Open for voting/ }))
        expect(screen.queryByRole("link", { name: /Expired decision/ })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /^Awaiting execution/ }))
        expect(screen.queryByRole("link", { name: /Expired decision/ })).not.toBeInTheDocument()
    })
})

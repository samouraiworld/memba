import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { Routes, Route } from "react-router-dom"
import { renderWithProviders } from "../test/test-utils"
import ValoperDetail from "./ValoperDetail"

vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
vi.mock("../lib/validators", () => ({ getValidators: vi.fn().mockResolvedValue([]) }))

import { queryRender } from "../lib/dao/shared"

const DETAIL = `Valoper's details:
## samourai-crew-1
Samourai's test13 validator.

- Operator Address: g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4
- Signing Address: g1abc000000000000000000000000000000000sig
- Signing PubKey: gpub1ptest
- Server Type: on-prem

[Profile link](/r/demo/profile:u/g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4)
`

function renderAt(addr: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/:network/validators/valoper/:operatorAddress" element={<ValoperDetail />} />
        </Routes>,
        { route: `/test13/validators/valoper/${addr}` },
    )
}

describe("ValoperDetail", () => {
    beforeEach(() => vi.clearAllMocks())

    it("renders the parsed valoper profile (moniker + operator address)", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt("g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4")
        expect(await screen.findByRole("heading", { name: "samourai-crew-1" })).toBeInTheDocument()
        expect(screen.getByText("g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4")).toBeInTheDocument()
    })

    it("shows a not-found state when the operator is unregistered", async () => {
        vi.mocked(queryRender).mockResolvedValue("unknown address g1nope")
        renderAt("g1nope")
        expect(await screen.findByText(/valoper not found/i)).toBeInTheDocument()
    })

    it("links 'View on gnoweb' to a test13 host, never mainnet gno.land", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt("g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4")
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        const link = screen.getByRole("link", { name: /view on gnoweb/i })
        const href = link.getAttribute("href") || ""
        expect(href).toContain("/r/gnops/valopers:")
        expect(href).not.toMatch(/\/\/gno\.land\//)
    })
})

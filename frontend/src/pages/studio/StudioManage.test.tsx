/**
 * StudioManage — unit tests (Task 5 + Task 11)
 *
 * Covers:
 *  - non-admin sees the gate message
 *  - admin sees all five section labels; default section is Mint
 *  - admin clicking Settings shows the GNOT hint (real SettingsSection)
 *  - admin clicking Withdraw shows the Withdraw proceeds button (real WithdrawSection)
 *  - loading state
 *  - collection not found state
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { StudioManage } from "./StudioManage"
import type { CollectionAdminResult } from "./useCollectionAdmin"

// ── Constants ──────────────────────────────────────────────────────────

const ME = "g1samourai000000000000000000000000001"
const CREATOR = ME
const SLUG = "cool-collection"
const COL_ID = `${CREATOR}/${SLUG}`

const BASE_COL = {
    name: "Cool Collection",
    symbol: "COOL",
    id: COL_ID,
    creator: ME,
    admin: ME,
    royaltyBps: 500,
    royaltyRecip: ME,
    phase: 2,
    mintPrice: 1_000_000,
    payDenom: "ugnot",
    minted: 0,
    maxSupply: 100,
    paused: false,
}

// ── Mocks ──────────────────────────────────────────────────────────────

let mockResult: CollectionAdminResult = {
    col: null,
    isAdmin: false,
    me: ME,
    loading: false,
    notice: null,
    error: null,
    run: vi.fn(),
    reload: vi.fn(),
}

vi.mock("./useCollectionAdmin", () => ({
    useCollectionAdmin: () => mockResult,
}))

// useNetworkPath returns a path builder; mock useParams is not needed since
// we use MemoryRouter with the right route pattern.
vi.mock("react-router-dom", async (orig) => {
    const mod = await orig<typeof import("react-router-dom")>()
    return {
        ...mod,
        useOutletContext: () => ({ adena: { address: ME } }),
    }
})

// ── Helpers ────────────────────────────────────────────────────────────

function renderManage() {
    return render(
        <MemoryRouter initialEntries={[`/test13/nft/studio/${CREATOR}/${SLUG}`]}>
            <Routes>
                <Route
                    path="/:network/nft/studio/:creator/:slug"
                    element={<StudioManage />}
                />
            </Routes>
        </MemoryRouter>,
    )
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("StudioManage — loading", () => {
    beforeEach(() => {
        mockResult = {
            col: null,
            isAdmin: false,
            me: ME,
            loading: true,
            notice: null,
            error: null,
            run: vi.fn(),
            reload: vi.fn(),
        }
    })

    it("shows a loading indicator", () => {
        renderManage()
        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })
})

describe("StudioManage — collection not found", () => {
    beforeEach(() => {
        mockResult = {
            col: null,
            isAdmin: false,
            me: ME,
            loading: false,
            notice: null,
            error: null,
            run: vi.fn(),
            reload: vi.fn(),
        }
    })

    it("shows not found message when col is null and not loading", () => {
        renderManage()
        expect(screen.getByText(/collection not found/i)).toBeInTheDocument()
    })
})

describe("StudioManage — non-admin gate", () => {
    beforeEach(() => {
        mockResult = {
            col: { ...BASE_COL },
            isAdmin: false,
            me: "g1other0000000000000000000000000000002",
            loading: false,
            notice: null,
            error: null,
            run: vi.fn(),
            reload: vi.fn(),
        }
    })

    it("shows the owner-only gate message", () => {
        renderManage()
        expect(
            screen.getByText(/only the collection owner can manage this/i),
        ).toBeInTheDocument()
    })

    it("renders a link to the public collection page", () => {
        renderManage()
        const link = screen.getByRole("link")
        expect(link).toHaveAttribute(
            "href",
            `/test13/nft/collection/${COL_ID}`,
        )
    })

    it("does not render the section nav", () => {
        renderManage()
        expect(screen.queryByRole("button", { name: /mint/i })).not.toBeInTheDocument()
    })
})

describe("StudioManage — admin shell", () => {
    beforeEach(() => {
        mockResult = {
            col: { ...BASE_COL },
            isAdmin: true,
            me: ME,
            loading: false,
            notice: null,
            error: null,
            run: vi.fn(),
            reload: vi.fn(),
        }
    })

    it("renders all five section nav labels", () => {
        renderManage()
        expect(screen.getByRole("button", { name: /^mint$/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^phases$/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^allowlist$/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^withdraw$/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^settings$/i })).toBeInTheDocument()
    })

    it("defaults to Mint section being active", () => {
        renderManage()
        const mintBtn = screen.getByRole("button", { name: /^mint$/i })
        expect(mintBtn).toHaveAttribute("aria-current", "true")
    })

    it("renders the Mint placeholder section body by default", () => {
        renderManage()
        const section = document.querySelector("[data-section='mint']")
        expect(section).toBeInTheDocument()
    })

    it("renders the collection name in the header", () => {
        renderManage()
        expect(screen.getByText("Cool Collection")).toBeInTheDocument()
    })

    it("renders the phase label in the header", () => {
        renderManage()
        // phase 2 → "Public" — match the span specifically (the link text also contains "public")
        expect(screen.getByText("Public")).toBeInTheDocument()
    })

    it("renders a 'View public page' link to the public collection route", () => {
        renderManage()
        const link = screen.getByRole("link", { name: /view public page/i })
        expect(link).toHaveAttribute(
            "href",
            `/test13/nft/collection/${COL_ID}`,
        )
    })

    it("clicking Settings shows the GNOT mint-price hint from SettingsSection", () => {
        renderManage()
        fireEvent.click(screen.getByRole("button", { name: /^settings$/i }))
        expect(screen.getByText(/minimum 0\.001 GNOT/i)).toBeInTheDocument()
    })

    it("clicking Withdraw shows the Withdraw proceeds button from WithdrawSection", () => {
        renderManage()
        fireEvent.click(screen.getByRole("button", { name: /^withdraw$/i }))
        expect(screen.getByRole("button", { name: /withdraw proceeds/i })).toBeInTheDocument()
    })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { StudioHome } from "./StudioHome"
import type { CollectionListRow } from "../../lib/launchpad"

// ── Mocks ──────────────────────────────────────────────────────────────

const ME = "g1samourai000000000000000000000000001"
const OTHER = "g1other0000000000000000000000000000002"

const OWNED_ROW: CollectionListRow = {
    name: "My Cool Collection",
    id: `${ME}/cool-collection`,
    creator: ME,
    slug: "cool-collection",
    phase: 2,
    minted: 42,
}

const OTHER_ROW: CollectionListRow = {
    name: "Someone Else Collection",
    id: `${OTHER}/other-collection`,
    creator: OTHER,
    slug: "other-collection",
    phase: 1,
    minted: 7,
}

const mockFetchCollectionList = vi.fn()

vi.mock("../../lib/launchpadReads", () => ({
    fetchCollectionList: (...args: unknown[]) => mockFetchCollectionList(...args),
}))

// Mock useOutletContext so we can control the wallet address per test
let mockAddress = ""

vi.mock("react-router-dom", async (orig) => {
    const mod = await orig<typeof import("react-router-dom")>()
    return {
        ...mod,
        useOutletContext: () => ({ adena: { address: mockAddress } }),
    }
})

// ── Helpers ────────────────────────────────────────────────────────────

function renderStudio() {
    return render(
        <MemoryRouter initialEntries={["/test13/nft/studio"]}>
            <Routes>
                <Route path="/:network/nft/studio" element={<StudioHome />} />
            </Routes>
        </MemoryRouter>,
    )
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("StudioHome — connect gate", () => {
    beforeEach(() => {
        mockAddress = ""
        mockFetchCollectionList.mockResolvedValue([])
    })

    it("prompts to connect when no wallet", () => {
        renderStudio()
        expect(screen.getByText(/connect/i)).toBeInTheDocument()
    })

    it("does not render the collection list when disconnected", () => {
        renderStudio()
        expect(screen.queryByText(/launch new collection/i)).not.toBeInTheDocument()
    })
})

describe("StudioHome — connected with collections", () => {
    beforeEach(() => {
        mockAddress = ME
        mockFetchCollectionList.mockResolvedValue([OWNED_ROW, OTHER_ROW])
    })

    it("renders the Launch CTA", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByText(/launch new collection/i)).toBeInTheDocument()
        )
    })

    it("shows only the collection owned by the current user", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByText("My Cool Collection")).toBeInTheDocument()
        )
        expect(screen.queryByText("Someone Else Collection")).not.toBeInTheDocument()
    })

    it("shows the phase label for the owned collection", async () => {
        renderStudio()
        // phase 2 → "Public"
        await waitFor(() =>
            expect(screen.getByText(/public/i)).toBeInTheDocument()
        )
    })

    it("shows the minted count for the owned collection", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByText(/42/)).toBeInTheDocument()
        )
    })

    it("collection item links to the correct studio path", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByRole("link", { name: /my cool collection/i })).toHaveAttribute(
                "href",
                `/test13/nft/studio/${ME}/cool-collection`,
            )
        )
    })

    it("Launch CTA links to nft/create", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByRole("link", { name: /launch new collection/i })).toHaveAttribute(
                "href",
                "/test13/nft/create",
            )
        )
    })
})

describe("StudioHome — connected, no collections", () => {
    beforeEach(() => {
        mockAddress = ME
        mockFetchCollectionList.mockResolvedValue([OTHER_ROW]) // none owned by ME
    })

    it("shows empty state message", async () => {
        renderStudio()
        await waitFor(() =>
            expect(
                screen.getByText(/you haven't launched any collections yet/i),
            ).toBeInTheDocument()
        )
    })

    it("still shows the Launch CTA in empty state", async () => {
        renderStudio()
        await waitFor(() =>
            expect(screen.getByText(/launch new collection/i)).toBeInTheDocument()
        )
    })
})

describe("StudioHome — loading state", () => {
    beforeEach(() => {
        mockAddress = ME
        // Never resolves during the test to stay in loading state
        mockFetchCollectionList.mockReturnValue(new Promise(() => {}))
    })

    it("shows a loading indicator while fetching", () => {
        renderStudio()
        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })
})

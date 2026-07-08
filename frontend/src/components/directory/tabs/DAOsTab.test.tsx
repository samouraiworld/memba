/**
 * DAOsTab.test.tsx
 *
 * R2-D2 render-level guard: the DAOs tab must show only DAOs that resolve on
 * the active network. A stale entry (saved on another testnet, 404s here) must
 * never render; a real entry must.
 *
 * Mutation check: filtering on `resolvedDAOs` is what enforces this — if the tab
 * is switched back to render the raw `allDAOs`, the "stale DAO is absent" test
 * fails. Verified manually during development.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { DirectoryDAO } from "../../../lib/directory"

// ── Mocks ─────────────────────────────────────────────────────

const REAL: DirectoryDAO = { name: "GovDAO", path: "gno.land/r/gov/dao", isSaved: false, category: "governance" }
const STALE: DirectoryDAO = { name: "FOUFOU DAO CLUB", path: "gno.land/r/foufou/dao", isSaved: true, category: "community" }

vi.mock("../../../lib/directory", () => ({
    // FeaturedDAOs reads SEED_DAOS; keep it empty so the carousel renders nothing
    // (its content is orthogonal to the resolve filter under test).
    SEED_DAOS: [],
    getDirectoryDAOs: vi.fn(() => [REAL, STALE]),
}))

// W3.2: the resolve hook now keys off a single Render("") per DAO. REAL renders
// (resolves + yields metadata); STALE returns null (dropped).
vi.mock("../../../lib/dao/shared", () => ({
    queryRender: vi.fn(async (_rpc: string, path: string) =>
        path === REAL.path ? "# GovDAO\n\nCore governance DAO\n\nMembers: 3\n" : null,
    ),
}))

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={["/test13/directory"]}>{children}</MemoryRouter>
            </QueryClientProvider>
        )
    }
}

// ── Tests ─────────────────────────────────────────────────────

describe("DAOsTab — resolve filter (R2-D2)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("renders a DAO that resolves on the active network", async () => {
        const { DAOsTab } = await import("./DAOsTab")
        render(<DAOsTab navigate={vi.fn()} />, { wrapper: makeWrapper() })

        await waitFor(() => expect(screen.getByText("GovDAO")).toBeInTheDocument())
    })

    it("never renders a stale DAO that 404s on the active network", async () => {
        const { DAOsTab } = await import("./DAOsTab")
        render(<DAOsTab navigate={vi.fn()} />, { wrapper: makeWrapper() })

        // Wait until the real DAO is on screen (resolution settled)…
        await waitFor(() => expect(screen.getByText("GovDAO")).toBeInTheDocument())
        // …then the stale one must be absent.
        expect(screen.queryByText("FOUFOU DAO CLUB")).not.toBeInTheDocument()
    })
})

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom"
import { Explorer } from "./Explorer"

// Renders the resulting URL so we can assert where the legacy redirect lands.
function LocationDisplay() {
    const loc = useLocation()
    return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/:network/explorer/*" element={<Explorer />} />
                <Route path="/:network/directory" element={<LocationDisplay />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("Explorer legacy redirect", () => {
    it("forwards /explorer/<realm> → /directory?tab=explorer&realm=<realm>", () => {
        renderAt("/test13/explorer/r/samcrew/memba_feed_v1")
        expect(screen.getByTestId("loc").textContent).toBe(
            "/test13/directory?tab=explorer&realm=r/samcrew/memba_feed_v1",
        )
    })

    it("strips render/help/query suffixes from the deep link", () => {
        renderAt("/test13/explorer/r/x/y:render/sub")
        expect(screen.getByTestId("loc").textContent).toBe(
            "/test13/directory?tab=explorer&realm=r/x/y",
        )
    })

    it("forwards a bare /explorer with no realm", () => {
        renderAt("/test13/explorer")
        expect(screen.getByTestId("loc").textContent).toBe(
            "/test13/directory?tab=explorer",
        )
    })
})

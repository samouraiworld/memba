import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it } from "vitest"
import ClassicToOs from "./ClassicToOs"

function Where() {
    const { pathname, search, hash } = useLocation()
    return <p>at {pathname + search + hash}</p>
}

function at(url: string) {
    render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/os/*" element={<Where />} />
                <Route path="*" element={<ClassicToOs><p>classic page</p></ClassicToOs>} />
            </Routes>
        </MemoryRouter>,
    )
}

// The test build loads on mainnet, as memba.club does.
describe("ClassicToOs", () => {
    it("opens a classic URL in its window, query and fragment kept", () => {
        at("/mainnet/feed/post/12?x=1#reply-3")
        expect(screen.getByText("at /os/feed/post/12?x=1#reply-3")).toBeInTheDocument()
    })

    it("leaves a page with no window classic", () => {
        at("/mainnet/github/callback?code=a&state=b")
        expect(screen.getByText("classic page")).toBeInTheDocument()
    })
})

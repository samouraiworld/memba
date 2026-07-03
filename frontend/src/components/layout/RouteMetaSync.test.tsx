/** W6.3 PR1 — RouteMetaSync writes head meta per route and NEVER touches title. */
import { describe, it, expect, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { RouteMetaSync } from "./RouteMetaSync"

const head = () => ({
    description: document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
    ogTitle: document.head.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
})

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/:network/*" element={<RouteMetaSync />} />
                <Route path="*" element={<RouteMetaSync />} />
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]').forEach(n => n.remove())
    document.title = "PAGE-OWNED TITLE"
})

describe("RouteMetaSync", () => {
    it("writes description, og:title, and canonical for a mapped route", () => {
        renderAt("/test13/directory")
        const h = head()
        expect(h.ogTitle).toContain("Directory")
        expect(h.description).toContain("organization hub")
        expect(h.canonical).toContain("/test13/directory")
    })

    it("never touches document.title (pages own it)", () => {
        renderAt("/test13/dao")
        expect(document.title).toBe("PAGE-OWNED TITLE")
    })

    it("updates on navigation between mapped routes", () => {
        const first = renderAt("/test13/dao")
        expect(head().ogTitle).toContain("DAOs")
        first.unmount()
        renderAt("/test13/validators")
        expect(head().ogTitle).toContain("Validators")
    })

    it("falls back to site meta on unmapped routes", () => {
        renderAt("/test13/uncharted")
        expect(head().ogTitle).toContain("Memba")
        expect(head().description).toBeTruthy()
    })
})

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
    document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], #memba-breadcrumbs').forEach(n => n.remove())
    document.title = "PAGE-OWNED TITLE"
})

const breadcrumbs = () => {
    const raw = document.getElementById("memba-breadcrumbs")?.textContent
    return raw ? JSON.parse(raw) : null
}

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

describe("RouteMetaSync — BreadcrumbList JSON-LD (W6.3 PR3)", () => {
    it("injects a two-level breadcrumb on a section route", () => {
        renderAt("/test13/directory")
        const b = breadcrumbs()
        expect(b["@type"]).toBe("BreadcrumbList")
        expect(b.itemListElement).toHaveLength(2)
        expect(b.itemListElement[1].name).toBe("Directory")
        expect(b.itemListElement[1].item).toContain("/test13/directory")
    })

    it("home gets a single-item trail", () => {
        renderAt("/test13/")
        expect(breadcrumbs().itemListElement).toHaveLength(1)
    })

    it("reuses one script node across navigations (no duplicates)", () => {
        const first = renderAt("/test13/dao")
        first.unmount()
        renderAt("/test13/validators")
        expect(document.querySelectorAll("#memba-breadcrumbs")).toHaveLength(1)
        expect(breadcrumbs().itemListElement[1].name).toBe("Validators")
    })
})

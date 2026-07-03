/** W6.4 — blog pages render the real shipped articles. */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { BlogList, BlogArticlePage } from "./Blog"
import { BLOG_ARTICLES } from "../lib/blog"

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/:network/blog" element={<BlogList />} />
                <Route path="/:network/blog/:slug" element={<BlogArticlePage />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("BlogList", () => {
    it("lists the shipped articles with network-prefixed links", () => {
        renderAt("/test13/blog")
        const cards = screen.getAllByTestId("blog-card")
        expect(cards.length).toBe(BLOG_ARTICLES.length)
        expect(cards[0].getAttribute("href")).toMatch(/^\/test13\/blog\//)
    })
})

describe("BlogArticlePage", () => {
    it("renders the first article's markdown body (sanitized HTML)", () => {
        const first = BLOG_ARTICLES[0]
        renderAt(`/test13/blog/${first.slug}`)
        expect(screen.getByText(first.title)).toBeTruthy()
        const body = screen.getByTestId("blog-body")
        expect(body.innerHTML).toContain("<h2")
        expect(body.innerHTML).not.toContain("<script")
    })

    it("unknown slug shows not-found with a back link", () => {
        renderAt("/test13/blog/no-such-post")
        expect(screen.getByText("Article not found.")).toBeTruthy()
        expect(screen.getByText("← All articles").getAttribute("href")).toBe("/test13/blog")
    })
})

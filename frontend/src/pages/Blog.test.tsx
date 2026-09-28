/** W6.4 — blog pages render the real shipped articles. */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BlogList, BlogArticlePage } from "./Blog"
import { BLOG_ARTICLES } from "../lib/blog"
import * as blogSource from "../lib/blogSource"
import { Changelogs } from "./Changelogs"
import { WindowActivityContext } from "../os/page/WindowActivity"

function renderAt(path: string, active = true) {
    // useBlogArticles goes through TanStack Query (flag-gated on-chain source;
    // static passthrough when off) — the page needs a provider either way.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={qc}>
        <WindowActivityContext.Provider value={active}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/:network/blog" element={<BlogList />} />
                    <Route path="/:network/blog/:slug" element={<BlogArticlePage />} />
                    <Route path="/:network/changelogs" element={<Changelogs />} />
                </Routes>
            </MemoryRouter>
        </WindowActivityContext.Provider>
        </QueryClientProvider>,
    )
}

describe("BlogList", () => {
    it("lists the shipped articles with network-prefixed links", () => {
        renderAt("/test13/blog")
        const cards = screen.getAllByTestId("blog-card")
        expect(cards.length).toBe(BLOG_ARTICLES.length)
        expect(cards[0].getAttribute("href")).toMatch(/^\/test13\/blog\//)
    })

    it("provides News section links and focuses the destination heading", async () => {
        renderAt("/mainnet/blog")
        expect(screen.getByRole("navigation", { name: "News sections" }).querySelector('[aria-current="page"]')).toHaveTextContent("Blog")
        await waitFor(() => expect(screen.getByRole("heading", { name: "Blog" })).toHaveFocus())
        fireEvent.click(screen.getByRole("link", { name: "Changelogs" }))
        await waitFor(() => expect(screen.getByRole("heading", { name: "Changelogs" })).toHaveFocus())
        expect(screen.getByRole("link", { name: "Blog" }).getAttribute("href")).toBe("/mainnet/blog")
    })

    it("does not overwrite the document title or focus from an inactive OS window", () => {
        document.title = "Active app — Memba"
        const anchor = document.createElement("button")
        document.body.append(anchor)
        anchor.focus()
        renderAt("/mainnet/blog", false)
        expect(document.title).toBe("Active app — Memba")
        expect(anchor).toHaveFocus()
        anchor.remove()
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

    it("does not load remote images from an on-chain article", () => {
        const source = vi.spyOn(blogSource, "useBlogArticles").mockReturnValue({
            articles: [{
                slug: "realm-post", title: "Realm post", date: "2026-09-28",
                description: "Remote", tags: [], body: "![tracker](https://example.org/pixel)",
                source: "onchain",
            }],
            loading: false,
        })
        try {
            renderAt("/mainnet/blog/realm-post")
            expect(screen.getByTestId("blog-body").querySelector("img")).toBeNull()
        } finally {
            source.mockRestore()
        }
    })

    it("keeps a revised article's publication and update dates distinct", () => {
        const revised = BLOG_ARTICLES.find(article => article.updated)
        expect(revised).toBeDefined()
        renderAt(`/mainnet/blog/${revised!.slug}`)
        expect(screen.getByText(`Published ${new Date(revised!.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`)).toBeInTheDocument()
        expect(screen.getByText(`Updated ${new Date(revised!.updated! + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`)).toBeInTheDocument()
    })

    it("unknown slug has a focused heading and a back link", async () => {
        document.title = "Another page — Memba"
        renderAt("/test13/blog/no-such-post")
        await waitFor(() => expect(screen.getByRole("heading", { name: "Article not found" })).toHaveFocus())
        expect(document.title).toBe("Blog — Memba")
        expect(screen.getByText("← All articles").getAttribute("href")).toBe("/test13/blog")
    })

    it("shows a loading status before treating an on-chain-only slug as missing", () => {
        const source = vi.spyOn(blogSource, "useBlogArticles").mockReturnValue({ articles: [], loading: true })
        try {
            renderAt("/mainnet/blog/pending-chain-post")
            expect(screen.getByRole("heading", { name: "Loading article" })).toHaveFocus()
            expect(screen.getByRole("status")).toHaveTextContent("Checking for the latest post")
            expect(document.title).toBe("Blog — Memba")
            expect(screen.queryByRole("heading", { name: "Article not found" })).toBeNull()
        } finally {
            source.mockRestore()
        }
    })

    it("moves keyboard focus to article and back to the list heading", async () => {
        renderAt("/mainnet/blog")
        fireEvent.click(screen.getAllByTestId("blog-card")[0])
        await waitFor(() => expect(screen.getByRole("heading", { name: BLOG_ARTICLES[0].title })).toHaveFocus())
        fireEvent.click(screen.getByRole("link", { name: /All articles/ }))
        await waitFor(() => expect(screen.getByRole("heading", { name: "Blog" })).toHaveFocus())
    })
})

import { useEffect, useRef, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BLOG_ARTICLES } from "../../../lib/blog"
import type { BlogArticle } from "../../../lib/blogParser"
import * as blogSource from "../../../lib/blogSource"
import { readingTime } from "../../../lib/blogView"
import { CHANGELOG_ENTRIES, filterChangelog } from "../../../lib/changelogView"
import { formatNewsDate } from "../../../lib/newsDate"
import { OS_ORIGIN } from "../../osSiteIdentity"
import { parseOsPath } from "../../shell/osPath"
import { specForTarget, urlForWindow, type WindowSpec } from "../../shell/windows"
import NewsWindow from "./native"

const base = { close: () => {}, toast: () => {}, fallback: <p>shell fallback</p>, session: { network: { key: "mainnet", chainId: "gnoland-1" } } as never, openApp: () => {} }

/** The section a deep link gives the News window, through the shell's own URL parser. */
function sectionOf(path: string): string | null {
    const target = parseOsPath(path)
    if (target.kind !== "app" || target.app !== "news") throw new Error(`${path} is not a News link`)
    return target.section
}

/**
 * A stand-in for the shell. `open` retargets the one News window and replaces its address, as
 * the desk does. `push` goes through the router, as the window frame's does: a history entry,
 * unless the target is the view already shown; the address reader below then retargets the
 * window, as the shell's does. `opened` sees the window spec either way.
 */
function Desk({ section, query, active, opened, pushed }: { section: string | null; query?: string; active: boolean; opened: (spec: WindowSpec) => void; pushed: (spec: WindowSpec) => void }) {
    const [target, setTarget] = useState({ section, query })
    const navigate = useNavigate()
    const location = useLocation()
    const read = useRef(location.key)
    /** The address this desk wrote itself: reading it back must not retarget the window again. */
    const written = useRef<string | null>(null)
    const retarget = (spec: WindowSpec) => {
        opened(spec)
        if (spec.target?.kind === "app") setTarget({ section: spec.target.section, query: spec.target.query })
    }
    useEffect(() => {
        if (read.current === location.key) return
        read.current = location.key
        if (written.current === location.pathname + location.search) { written.current = null; return }
        const pushed = parseOsPath(location.pathname)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- stands in for the shell's address reader, which follows the router
        if (pushed.kind === "app" && pushed.app === "news") retarget(specForTarget({ ...pushed, query: location.search.slice(1) || undefined })!)
    })
    const open = (spec: WindowSpec) => {
        retarget(spec)
        written.current = urlForWindow(spec)
        navigate(written.current, { replace: true })
    }
    const push = (spec: WindowSpec) => {
        pushed(spec)
        const url = urlForWindow(spec)
        if (url !== location.pathname + location.search) navigate(url)
    }
    return <><NewsWindow {...base} section={target.section} query={target.query} active={active} open={open} push={push} /><button type="button" onClick={() => navigate(-1)}>Browser back</button></>
}

function renderNews(path: string, options: { query?: string; active?: boolean } = {}) {
    const opened = vi.fn<(spec: WindowSpec) => void>()
    const pushed = vi.fn<(spec: WindowSpec) => void>()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const at = options.query ? `${path}?${options.query}` : path
    const wrap = (children: ReactNode) => (
        <QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}>{children}</MemoryRouter></QueryClientProvider>
    )
    // The window frame is the outermost element a view may scroll.
    const view = render(wrap(<div className="os-win"><Desk section={sectionOf(path)} query={options.query} active={options.active ?? true} opened={opened} pushed={pushed} /></div>))
    return { ...view, opened, pushed }
}

function serve(articles: BlogArticle[], loading = false) {
    vi.spyOn(blogSource, "useBlogArticles").mockReturnValue({ articles, loading })
}

const post = (over: Partial<BlogArticle>): BlogArticle => ({
    slug: "fixture-post", title: "Fixture post", date: "2026-09-01", description: "A fixture.", tags: ["memba"], body: "Body.", ...over,
})

afterEach(() => { vi.restoreAllMocks() })

describe("News window · Blog", () => {
    it("lists every article newest first with its date, reading time and tags, and asks for no wallet", () => {
        renderNews("/os/news")
        const nav = screen.getByRole("navigation", { name: "News" })
        expect(within(nav).getByRole("button", { name: "Blog" })).toHaveAttribute("aria-current", "true")
        expect(within(nav).getByRole("button", { name: "Changelogs" })).not.toHaveAttribute("aria-current")
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()

        const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
        expect(titles).toEqual(BLOG_ARTICLES.map((a) => a.title))
        const first = BLOG_ARTICLES[0]
        const card = screen.getByRole("button", { name: first.title }).closest("li")!
        expect(card).toHaveTextContent(formatNewsDate(first.date))
        expect(card).toHaveTextContent(readingTime(first.body))
        expect(within(card).getByRole("list", { name: "Tags" })).toHaveTextContent(first.tags.join(""))

        // Nine articles share the newest date: none of them is called the latest.
        expect(screen.queryByText(/latest/i)).toBeNull()
        expect(screen.queryByRole("button", { name: /connect/i })).toBeNull()
        const rss = screen.getByRole("link", { name: /RSS feed/ })
        expect(rss).toHaveAttribute("href", "/blog.rss")
        expect(rss).toHaveAttribute("target", "_blank")
        expect(rss).toHaveAttribute("rel", "noopener noreferrer")
    })

    it("says so when nothing is published", () => {
        serve([])
        renderNews("/os/news")
        expect(screen.getByText("No articles have been published yet.")).toBeInTheDocument()
        expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
    })

    it("opens an article in the same window with focus on its title, and goes back to the card it came from", () => {
        const { opened } = renderNews("/os/news")
        const article = BLOG_ARTICLES[3]
        const card = screen.getByRole("button", { name: article.title })
        card.focus()
        fireEvent.click(card)
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:news", target: { kind: "app", app: "news", section: article.slug } }))

        const title = screen.getByRole("heading", { level: 1, name: article.title })
        expect(title).toHaveFocus()
        expect(screen.getByText(`Published ${formatNewsDate(article.date)}`)).toBeInTheDocument()
        expect(screen.getByText(readingTime(article.body))).toBeInTheDocument()
        expect(screen.getByTestId("news-body").querySelector("h2")).not.toBeNull()
        // The sidebar still says where the reader is.
        expect(screen.getByRole("button", { name: "Blog" })).toHaveAttribute("aria-current", "true")

        const back = screen.getByRole("button", { name: "All articles" })
        back.focus()
        fireEvent.click(back)
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "news", section: null } }))
        expect(screen.getByRole("button", { name: article.title })).toHaveFocus()
    })

    it("takes focus into the article when the clicked card does not take focus itself, as in Safari and Firefox on macOS", () => {
        renderNews("/os/news")
        const article = BLOG_ARTICLES[3]
        // Focus is on a control that stays on screen; the click leaves it there.
        const sidebarBlog = within(screen.getByRole("navigation", { name: "News" })).getByRole("button", { name: "Blog" })
        sidebarBlog.focus()
        fireEvent.click(screen.getByRole("button", { name: article.title }))
        expect(screen.getByRole("heading", { level: 1, name: article.title })).toHaveFocus()
    })

    it("makes an opened article a history entry, so the browser's Back returns to the list", () => {
        renderNews("/os/news")
        const article = BLOG_ARTICLES[3]
        fireEvent.click(screen.getByRole("button", { name: article.title }))
        expect(screen.getByRole("heading", { level: 1, name: article.title })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Browser back" }))
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: article.title })).toBeInTheDocument()
    })

    it("puts focus back on the card when the browser's Back takes the focused article title away", () => {
        renderNews("/os/news")
        const article = BLOG_ARTICLES[3]
        fireEvent.click(screen.getByRole("button", { name: article.title }))
        expect(screen.getByRole("heading", { level: 1, name: article.title })).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "Browser back" }))
        expect(screen.getByRole("button", { name: article.title })).toHaveFocus()
    })

    it("focuses the article title when Back leaves nothing focused and there is no card to return to", () => {
        const article = BLOG_ARTICLES[3]
        renderNews(`/os/news/${article.slug}`)
        const back = screen.getByRole("button", { name: "All articles" })
        back.focus()
        fireEvent.click(back)
        // The list took "All articles" away and focused the card; Back unmounts that card in turn.
        expect(screen.getByRole("button", { name: article.title })).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "Browser back" }))
        expect(screen.getByRole("heading", { level: 1, name: article.title })).toHaveFocus()
    })

    it("never scrolls anything above its own window", () => {
        const { container } = renderNews("/os/news")
        Object.defineProperty(container, "scrollTop", { value: 300, writable: true })
        fireEvent.click(screen.getByRole("button", { name: "Changelogs" }))
        expect(screen.getByRole("heading", { level: 1, name: "Changelogs" })).toBeInTheDocument()
        expect(container.scrollTop).toBe(300)
    })

    it("starts a new view at the top, and leaves focus in the sidebar when the section changes from there", () => {
        renderNews("/os/news")
        const scroller = screen.getByRole("heading", { level: 1, name: "Blog" }).closest("section")!
        // jsdom lays nothing out: give the scroller a position to lose.
        Object.defineProperty(scroller, "scrollTop", { value: 480, writable: true })
        const changelogs = screen.getByRole("button", { name: "Changelogs" })
        changelogs.focus()
        fireEvent.click(changelogs)
        expect(screen.getByRole("heading", { level: 1, name: "Changelogs" })).toBeInTheDocument()
        expect(scroller.scrollTop).toBe(0)
        expect(changelogs).toHaveFocus()
    })

    it("keeps a revised article's publication and update dates apart", () => {
        const revised = BLOG_ARTICLES.find((a) => a.updated)!
        renderNews(`/os/news/${revised.slug}`)
        expect(screen.getByText(`Published ${formatNewsDate(revised.date)}`)).toBeInTheDocument()
        expect(screen.getByText(`Updated ${formatNewsDate(revised.updated!)}`)).toBeInTheDocument()
    })

    it("renders an article body only through the safe renderer", () => {
        serve([post({
            slug: "hostile",
            body: [
                '<img src="x" onerror="window.pwned = 1"><script>window.pwned = 2</script>',
                "[in app](/mainnet/dao) [outside](https://example.org/page) [trap](javascript:alert(1))",
                "![diagram](https://example.org/diagram.png)",
            ].join("\n\n"),
        })])
        renderNews("/os/news/hostile")
        const body = screen.getByTestId("news-body")
        // Raw HTML in the source is text, never markup.
        expect(body.querySelector("script, [onerror]")).toBeNull()
        expect(body).toHaveTextContent('<img src="x" onerror="window.pwned = 1">')
        const link = (name: string) => within(body).getByRole("link", { name })
        expect(link("trap")).toHaveAttribute("href", "#")
        expect(link("outside")).toHaveAttribute("target", "_blank")
        expect(link("outside")).toHaveAttribute("rel", "noopener noreferrer")
        // The sanitizer, not only the markdown renderer, ran: an in-app link loses the new-tab target.
        expect(link("in app")).not.toHaveAttribute("target")
        // A reviewed static post may show its images.
        expect(body.querySelector("img")).toHaveAttribute("src", "https://example.org/diagram.png")
    })

    it("opens an in-app link in an article in Memba OS instead of reloading out of it, and leaves the other links to the browser", () => {
        serve([post({ slug: "links", body: "[in app](/mainnet/dao) [outside](https://example.org/page) [unknown](/mainnet/no-such-page)" })])
        const { pushed } = renderNews("/os/news/links")
        const body = screen.getByTestId("news-body")
        const click = (name: string, init: MouseEventInit = {}) => !fireEvent.click(within(body).getByRole("link", { name }), init)
        expect(click("in app")).toBe(true)
        expect(pushed).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "daos", section: null, query: "" } }))
        pushed.mockClear()
        // A modified click, a new-tab link and a page with no window keep the browser's behaviour.
        expect(click("in app", { metaKey: true })).toBe(false)
        expect(click("outside")).toBe(false)
        expect(click("unknown")).toBe(false)
        expect(pushed).not.toHaveBeenCalled()
    })

    it("never loads a remote image from an on-chain article", () => {
        serve([post({ slug: "realm-post", source: "onchain", body: "![tracker](https://example.org/pixel)" })])
        renderNews("/os/news/realm-post")
        expect(screen.getByTestId("news-body").querySelector("img")).toBeNull()
    })

    it("says an unknown article is not found and offers the way back", () => {
        const { opened } = renderNews("/os/news/no-such-post")
        expect(screen.getByRole("heading", { level: 1, name: "Article not found" })).toBeInTheDocument()
        expect(screen.getByText("No article was found at this address.")).toBeInTheDocument()
        expect(screen.queryByTestId("news-body")).toBeNull()
        expect(screen.queryByText("shell fallback")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "All articles" }))
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "news", section: null } }))
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()
    })

    it("waits for on-chain posts before calling a slug missing", () => {
        serve([], true)
        renderNews("/os/news/pending-chain-post")
        expect(screen.getByRole("heading", { level: 1, name: "Loading article" })).toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("Checking for the latest post")
        expect(screen.queryByText("No article was found at this address.")).toBeNull()
    })

    it("gives the page head the article's identity only while the article is the address, and puts it back after", () => {
        document.title = "Memba OS"
        const article = BLOG_ARTICLES[0]
        const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null
        const front = renderNews(`/os/news/${article.slug}`)
        expect(document.title).toBe(`${article.title} — Memba`)
        expect(canonical()).toBe(`${OS_ORIGIN}/os/news/${article.slug}`)
        fireEvent.click(screen.getByRole("button", { name: "All articles" }))
        expect(document.title).toBe("Memba OS")
        expect(canonical()).toBeNull()
        front.unmount()

        // The classic spelling of the address writes the same canonical link as the short one.
        const classic = renderNews(`/os/news/blog/${article.slug}`)
        expect(document.title).toBe(`${article.title} — Memba`)
        expect(canonical()).toBe(`${OS_ORIGIN}/os/news/${article.slug}`)
        classic.unmount()

        // The same article in a window behind another one: the head is the front window's.
        renderNews(`/os/news/${article.slug}`, { active: false })
        expect(screen.getByRole("heading", { level: 1, name: article.title })).toBeInTheDocument()
        expect(document.title).toBe("Memba OS")
    })
})

describe("News window · Changelogs", () => {
    const entryCount = () => document.querySelectorAll(".os-news-entry").length

    it("shows current and legacy entries, the unreleased block once, and the full changelog link", () => {
        renderNews("/os/news/changelogs")
        const nav = screen.getByRole("navigation", { name: "News" })
        expect(within(nav).getByRole("button", { name: "Changelogs" })).toHaveAttribute("aria-current", "true")
        expect(screen.getByRole("heading", { level: 1, name: "Changelogs" })).toBeInTheDocument()
        expect(entryCount()).toBe(CHANGELOG_ENTRIES.length)
        // Current releases come from CHANGELOG.md, the curated history from the legacy list.
        expect(screen.getByRole("heading", { level: 2, name: "September 23, 2026" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 3, name: "Release v7.7.0" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 3, name: "v3.2.0 Multi-Model AI Consensus & Governance Discovery" })).toBeInTheDocument()
        // The unreleased block is headed once; shipped interim blocks sit under their version.
        expect(screen.getAllByText("Unreleased")).toHaveLength(1)
        expect(screen.getByRole("heading", { level: 2, name: "v6.2.2" })).toBeInTheDocument()
        const full = screen.getByRole("link", { name: /Full changelog/ })
        expect(full).toHaveAttribute("href", "https://github.com/samouraiworld/memba/blob/main/CHANGELOG.md")
        expect(full).toHaveAttribute("target", "_blank")
        expect(full).toHaveAttribute("rel", "noopener noreferrer")
        expect(screen.queryByRole("button", { name: /connect/i })).toBeNull()
    })

    it("filters by tag through the window query, with true counts", () => {
        const { opened } = renderNews("/os/news/changelogs")
        const filters = screen.getByRole("group", { name: "Filter changelogs" })
        const network = filterChangelog(CHANGELOG_ENTRIES, "network")
        expect(network.length).toBeGreaterThan(0)
        expect(network.length).toBeLessThan(CHANGELOG_ENTRIES.length)
        const chip = (name: string) => within(filters).getByRole("button", { name })
        expect(chip(`All ${CHANGELOG_ENTRIES.length}`)).toHaveAttribute("aria-pressed", "true")

        fireEvent.click(chip(`Network ${network.length}`))
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "news", section: "changelogs", query: "tag=network" } }))
        expect(chip(`Network ${network.length}`)).toHaveAttribute("aria-pressed", "true")
        expect(chip(`All ${CHANGELOG_ENTRIES.length}`)).toHaveAttribute("aria-pressed", "false")
        expect(entryCount()).toBe(network.length)
        expect(screen.getByRole("heading", { level: 3, name: "Betanet (gnoland1) Stable" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { level: 3, name: /Hardening & OSS Preparation/ })).toBeNull()

        fireEvent.click(chip(`All ${CHANGELOG_ENTRIES.length}`))
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "news", section: "changelogs", query: "" } }))
        expect(entryCount()).toBe(CHANGELOG_ENTRIES.length)
    })

    it("makes a sidebar change a history entry, and a filter a refinement of the page it is on", () => {
        const network = filterChangelog(CHANGELOG_ENTRIES, "network")
        renderNews("/os/news")
        fireEvent.click(screen.getByRole("button", { name: "Changelogs" }))
        fireEvent.click(screen.getByRole("button", { name: `Network ${network.length}` }))
        expect(entryCount()).toBe(network.length)
        // One step back leaves the changelog: the filter replaced its address instead of adding one.
        fireEvent.click(screen.getByRole("button", { name: "Browser back" }))
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()
    })

    it("does nothing when the current sidebar section is chosen again: no history entry, and the filter stays", () => {
        const network = filterChangelog(CHANGELOG_ENTRIES, "network")
        const { opened } = renderNews("/os/news")
        fireEvent.click(screen.getByRole("button", { name: "Changelogs" }))
        fireEvent.click(screen.getByRole("button", { name: `Network ${network.length}` }))
        const calls = opened.mock.calls.length
        fireEvent.click(within(screen.getByRole("navigation", { name: "News" })).getByRole("button", { name: "Changelogs" }))
        expect(opened).toHaveBeenCalledTimes(calls)
        expect(screen.getByRole("button", { name: `Network ${network.length}` })).toHaveAttribute("aria-pressed", "true")
        fireEvent.click(screen.getByRole("button", { name: "Browser back" }))
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()
    })

    it("opens on the linked filter, and on everything for a filter it does not know", () => {
        const core = filterChangelog(CHANGELOG_ENTRIES, "gno-core")
        const linked = renderNews("/os/news/changelogs", { query: "tag=gno-core" })
        expect(screen.getByRole("button", { name: `Gno Core ${core.length}` })).toHaveAttribute("aria-pressed", "true")
        expect(entryCount()).toBe(core.length)
        linked.unmount()
        renderNews("/os/news/changelogs", { query: "tag=everything" })
        expect(screen.getByRole("button", { name: `All ${CHANGELOG_ENTRIES.length}` })).toHaveAttribute("aria-pressed", "true")
        expect(entryCount()).toBe(CHANGELOG_ENTRIES.length)
    })
})

describe("News window · sections", () => {
    it("reads the classic spellings of its pages too", () => {
        const list = renderNews("/os/news/blog")
        expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument()
        list.unmount()
        renderNews(`/os/news/blog/${BLOG_ARTICLES[1].slug}`)
        expect(screen.getByRole("heading", { level: 1, name: BLOG_ARTICLES[1].title })).toBeInTheDocument()
    })

    it("opens an article whose slug is a section name at an address that comes back to it", () => {
        serve([post({ slug: "changelogs", title: "A post about changelogs" })])
        const { opened } = renderNews("/os/news")
        fireEvent.click(screen.getByRole("button", { name: "A post about changelogs" }))
        expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "news", section: "blog/changelogs" } }))
        expect(screen.getByRole("heading", { level: 1, name: "A post about changelogs" })).toBeInTheDocument()
    })

    it("leaves an address that is not a News page to the shell", () => {
        renderNews("/os/news/2026/september")
        expect(screen.getByText("shell fallback")).toBeInTheDocument()
        expect(screen.queryByRole("navigation", { name: "News" })).toBeNull()
    })
})

/**
 * News: the Blog (the article list, and one article per window section) and
 * the Changelogs. Everything here is public reading: no wallet, no gate.
 * Window sections follow os/page/classicRoute: none = the list, `<slug>` = an
 * article, `changelogs` = the changelog.
 */
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react"
import { applyArticleHeadMeta, clearArticleHeadMeta } from "../../../lib/blogMeta"
import type { BlogArticle } from "../../../lib/blogParser"
import { useBlogArticles } from "../../../lib/blogSource"
import { articleBodyHtml, readingTime } from "../../../lib/blogView"
import {
    CHANGELOG_ENTRIES, CHANGELOG_FILTERS, CHANGELOG_LABELS, FULL_CHANGELOG_URL,
    filterChangelog, groupChangelog, type ChangelogEntry, type ChangelogFilter,
} from "../../../lib/changelogView"
import { formatNewsDate } from "../../../lib/newsDate"
import { AppShell, Card, Chips, Empty, Loading, Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { OS_ORIGIN } from "../../osSiteIdentity"
import { classicForSection, osTargetForClassic, sectionForClassic } from "../../page/classicRoute"
import { specForTarget, urlForWindow, type WindowSpec } from "../../shell/windows"
import "./news.css"

const sections = [
    { id: "blog", name: "Blog", icon: "news" },
    { id: "changelogs", name: "Changelogs", icon: "doc" },
] as const

type View = { kind: "blog" } | { kind: "changelogs" } | { kind: "article"; slug: string }

/** What a window section shows, read through the shell's own section ⇄ page mapping (null: not a News page). */
function viewFor(section: string | null): View | null {
    const page = classicForSection("news", section)
    if (page === null) return null
    if (page === "blog") return { kind: "blog" }
    if (page === "changelogs") return { kind: "changelogs" }
    return { kind: "article", slug: page.slice("blog/".length) }
}

function Tags({ tags }: { tags: readonly string[] }) {
    if (tags.length === 0) return null
    return <ul className="os-news-tags" aria-label="Tags">{tags.map((tag) => <li key={tag}><Pill tone="neutral">{tag}</Pill></li>)}</ul>
}

function BlogView({ openArticle }: { openArticle: (slug: string) => void }) {
    const { articles } = useBlogArticles()
    return <>
        <header className="os-news-head">
            <div>
                <h1 tabIndex={-1}>Blog</h1>
                <p className="os-sub">Articles on Memba and the gno.land ecosystem.</p>
            </div>
            <a className="os-btn os-quiet" href="/blog.rss" target="_blank" rel="noopener noreferrer">RSS feed <span aria-hidden="true">↗</span></a>
        </header>
        {articles.length === 0
            ? <Empty title="No articles have been published yet." />
            // Newest first; the first one spans the grid (news.css).
            : <ul className="os-news-grid">{articles.map((article) => <li key={article.slug}>
                <Card>
                    <div className="os-news-card">
                        <p className="os-sub">{formatNewsDate(article.date)} <span aria-hidden="true">·</span> {readingTime(article.body)}</p>
                        <h2><button type="button" className="os-news-open" data-article={article.slug} onClick={() => openArticle(article.slug)}>{article.title}</button></h2>
                        {article.description && <p className="os-news-desc">{article.description}</p>}
                        <Tags tags={article.tags} />
                    </div>
                </Card>
            </li>)}</ul>}
    </>
}

/**
 * The page head carries the article's identity only while its window is the
 * front one: the OS build serves a static shell for /os/news/<slug> with the
 * article's title and metadata already in it, and blogMeta puts the site's own
 * head back when the window closes or another one comes forward.
 */
function useArticleHead(article: BlogArticle | undefined, active: boolean, canonical: string) {
    useEffect(() => {
        if (!article || !active) return
        applyArticleHeadMeta(article, `${OS_ORIGIN}${canonical}`)
        return clearArticleHeadMeta
    }, [article, active, canonical])
}

/**
 * A plain click on an in-app link inside an article opens its page in Memba OS, as a link in
 * a classic page does, instead of reloading out of it. A new-tab link, a modified click and a
 * page Memba OS has no window for keep the browser's own behaviour.
 */
function inAppLink(event: ReactMouseEvent, network: string): WindowSpec | null {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
    const link = (event.target as Element).closest("a")
    if (!link || link.target || link.origin !== window.location.origin) return null
    const target = osTargetForClassic(link.pathname + link.search, network)
    // A page link is the whole address: no query means the page has none.
    return target && specForTarget(target.kind === "app" ? { ...target, query: target.query ?? "" } : target)
}

function ArticleView({ slug, active, canonical, toList, openLink }: { slug: string; active: boolean; canonical: string; toList: () => void; openLink: (event: ReactMouseEvent) => void }) {
    const { articles, loading } = useBlogArticles()
    const article = articles.find((a) => a.slug === slug)
    useArticleHead(article, active, canonical)
    return (
        <article className="os-news-article">
            <button type="button" className="os-btn os-quiet" onClick={toList}><span aria-hidden="true">←</span> All articles</button>
            <h1 tabIndex={-1}>{article ? article.title : loading ? "Loading article" : "Article not found"}</h1>
            {article ? <>
                <p className="os-news-meta">
                    <span>Published {formatNewsDate(article.date)}</span>
                    {article.updated && <span>Updated {formatNewsDate(article.updated)}</span>}
                    <span>{readingTime(article.body)}</span>
                </p>
                <Tags tags={article.tags} />
                <div className="os-news-body" data-testid="news-body" onClick={openLink} dangerouslySetInnerHTML={{ __html: articleBodyHtml(article) }} />
            </> : loading
                ? <Loading label="Checking for the latest post…" />
                : <Empty title="No article was found at this address." />}
        </article>
    )
}

/** An entry's own heading, without what its group heading or its title already says. */
function entryHeading(entry: ChangelogEntry, groupLabel: string): { version?: string; title?: string } {
    return {
        version: entry.version && entry.version !== groupLabel && !entry.title.includes(entry.version) ? entry.version : undefined,
        title: entry.title !== groupLabel ? entry.title : undefined,
    }
}

function ChangelogView({ filter, setFilter }: { filter: ChangelogFilter; setFilter: (next: ChangelogFilter) => void }) {
    const groups = groupChangelog(filterChangelog(CHANGELOG_ENTRIES, filter))
    return (
        <div className="os-news-log">
            <header className="os-news-head">
                <div>
                    <h1 tabIndex={-1}>Changelogs</h1>
                    <p className="os-sub">Memba releases and gno.land ecosystem updates.</p>
                </div>
                <a className="os-btn os-quiet" href={FULL_CHANGELOG_URL} target="_blank" rel="noopener noreferrer">Full changelog <span aria-hidden="true">↗</span></a>
            </header>
            <Chips label="Filter changelogs" value={filter} onChange={setFilter}
                options={CHANGELOG_FILTERS.map((id) => ({ id, name: CHANGELOG_LABELS[id], count: filterChangelog(CHANGELOG_ENTRIES, id).length }))} />
            {groups.length === 0 && <Empty title="No entries for this filter." />}
            {groups.map((group) => (
                <section key={group.key} className="os-news-group">
                    <h2 className="os-h">{group.label}</h2>
                    {group.entries.map((entry, i) => {
                        const { version, title } = entryHeading(entry, group.label)
                        return <Card key={i}>
                            <div className="os-news-entry">
                                {(version || title) && <h3>{version && <Pill>{version}</Pill>}{version && title && " "}{title}</h3>}
                                <Tags tags={entry.tags.map((tag) => CHANGELOG_LABELS[tag])} />
                                <ul className="os-news-items">{entry.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
                            </div>
                        </Card>
                    })}
                </section>
            ))}
        </div>
    )
}

export default function NewsWindow({ section, query, session, active, open, push, fallback }: NativeViewProps) {
    const view = viewFor(section)
    const viewKey = view === null ? null : view.kind === "article" ? `article:${view.slug}` : view.kind
    const root = useRef<HTMLDivElement>(null)
    const shown = useRef(viewKey)
    /** Set by the view's own controls (an article card, All articles): the control they leave is gone afterwards. */
    const carryFocus = useRef(false)
    useEffect(() => {
        const from = shown.current
        shown.current = viewKey
        const el = root.current
        if (!el || from === viewKey) return
        // The window keeps one scroller for every view: start the new view at its top.
        // The search stops at the window (or the phone sheet), never above it.
        for (let up = el.parentElement; up; up = up.parentElement) {
            if (up.scrollTop > 0) { up.scrollTop = 0; break }
            if (up.matches(".os-win, .os-ph-sheet")) break
        }
        // Focus follows the reader into an article (its title) and back out (the
        // card they opened). A change from the sidebar, a link or another window
        // leaves focus where it is, unless the view that went away took the
        // focused element with it (the browser's Back from an article).
        const carried = carryFocus.current
        carryFocus.current = false
        if (!carried && document.activeElement !== document.body) return
        const origin = from?.startsWith("article:")
            ? Array.from(el.querySelectorAll<HTMLElement>("[data-article]")).find((card) => card.dataset.article === from.slice("article:".length))
            : undefined
        ;(origin ?? el.querySelector<HTMLElement>("h1"))?.focus()
    }, [viewKey])

    if (view === null) return <>{fallback}</>
    const spec = (next: string | null, nextQuery?: string) =>
        specForTarget({ kind: "app", app: "news", section: next, ...(nextQuery === undefined ? {} : { query: nextQuery }) })!
    // The list, an article and the changelog are pages: each is a history entry, so the
    // browser's Back steps through them.
    const go = (next: string | null) => push(spec(next))
    const follow = (next: string | null) => { carryFocus.current = true; go(next) }
    const tag = new URLSearchParams(query).get("tag")

    return (
        <AppShell label="News" sections={sections} current={view.kind === "changelogs" ? "changelogs" : "blog"}
            // The Changelogs entry while on the changelog is the current page: no new history entry, and its filter stays.
            onSelect={(id) => { if (id !== "changelogs" || view.kind !== "changelogs") go(id === "blog" ? null : id) }}>
            <div className="os-news" ref={root}>
                {view.kind === "blog" && <BlogView openArticle={(slug) => follow(sectionForClassic("news", `blog/${slug}`))} />}
                {view.kind === "article" && <ArticleView key={view.slug} slug={view.slug}
                    active={active}
                    openLink={(event) => {
                        const spec = inAppLink(event, session.network.key)
                        if (!spec) return
                        event.preventDefault()
                        push(spec)
                    }}
                    // One address per article, the one the static shell and the sitemap use, however this window was reached.
                    canonical={urlForWindow(spec(sectionForClassic("news", `blog/${view.slug}`)))} toList={() => follow(null)} />}
                {view.kind === "changelogs" && <ChangelogView filter={CHANGELOG_FILTERS.find((id) => id === tag) ?? "all"}
                    // A filter refines the page it is on: it replaces the address instead of adding an entry.
                    setFilter={(next) => open(spec("changelogs", next === "all" ? "" : `tag=${next}`))} />}
            </div>
        </AppShell>
    )
}

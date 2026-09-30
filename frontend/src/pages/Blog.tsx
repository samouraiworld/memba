/**
 * Blog — W6.4: article list + article view (/blog, /blog/:slug).
 *
 * Content: markdown files in content/blog/ (see lib/blogParser.ts for the
 * front-matter contract). Rendered with the XSS-safe markdownLite renderer
 * (escaped content, protocol-whitelisted links) + DOMPurify, matching the
 * house pattern for realm Render output.
 */
import { useEffect, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { Rss, ArrowLeft } from "@phosphor-icons/react"
import { useBlogArticles } from "../lib/blogSource"
import { articleBodyHtml, readingTime } from "../lib/blogView"
import { formatNewsDate as formatDate } from "../lib/newsDate"
import { applyArticleHeadMeta, clearArticleHeadMeta } from "../lib/blogMeta"
import { useNetworkKey } from "../hooks/useNetworkNav"
import "./blog.css"

export function BlogList() {
    const nk = useNetworkKey()
    const headingRef = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        const previousTitle = document.title
        document.title = "Blog — Memba"
        headingRef.current?.focus()
        return () => {
            if (document.title === "Blog — Memba") document.title = previousTitle
        }
    }, [])

    const { articles } = useBlogArticles()
    const [featured, ...rest] = articles

    return (
        <div id="blog-page" className="blog-shell">
            <nav className="news-section-nav" aria-label="News sections">
                <Link to={`/${nk}/blog`} aria-current="page">Blog</Link>
                <Link to={`/${nk}/changelogs`}>Changelogs</Link>
            </nav>
            {/* ── Masthead ─────────────────────────────────────── */}
            <header className="blog-masthead">
                <div className="blog-masthead__kicker">Memba · gno.land</div>
                <h1 ref={headingRef} tabIndex={-1} className="blog-masthead__title">Blog</h1>
                <p className="blog-masthead__sub">
                    Field notes on Memba and the gno.land ecosystem — releases, security, and what we're building.
                </p>
                <a className="blog-masthead__rss" href="/blog.rss" aria-label="RSS feed">
                    <Rss size={13} weight="bold" aria-hidden="true" /> RSS
                </a>
            </header>

            {articles.length === 0 && (
                <p className="blog-empty">No articles yet.</p>
            )}

            {/* ── Featured (latest) ────────────────────────────── */}
            {featured && (
                <Link to={`/${nk}/blog/${featured.slug}`} className="blog-featured" data-testid="blog-card">
                    <div className="blog-featured__meta">
                        <span className="blog-featured__latest">Latest</span>
                        <span>{formatDate(featured.date)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{readingTime(featured.body)}</span>
                    </div>
                    <h2 className="blog-featured__title">{featured.title}</h2>
                    <p className="blog-featured__desc">{featured.description}</p>
                    <div className="blog-featured__foot">
                        {featured.tags.length > 0 && (
                            <div className="blog-card__tags">
                                {featured.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
                            </div>
                        )}
                        <span className="blog-featured__more">Read <span aria-hidden="true">→</span></span>
                    </div>
                </Link>
            )}

            {/* ── Index (the rest) ─────────────────────────────── */}
            {rest.length > 0 && (
                <div className="blog-index">
                    <div className="blog-index__label">More posts</div>
                    {rest.map(a => (
                        <Link key={a.slug} to={`/${nk}/blog/${a.slug}`} className="blog-row" data-testid="blog-card">
                            <div className="blog-row__date">{formatDate(a.date)}</div>
                            <div className="blog-row__main">
                                <div className="blog-row__title">{a.title}</div>
                                <div className="blog-row__desc">{a.description}</div>
                                {a.tags.length > 0 && (
                                    <div className="blog-card__tags">
                                        {a.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
                                    </div>
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}

export function BlogArticlePage() {
    const { slug } = useParams<{ slug: string }>()
    const nk = useNetworkKey()
    const { articles, loading } = useBlogArticles()
    const article = slug ? articles.find(a => a.slug === slug) : undefined
    const headingRef = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        headingRef.current?.focus()
    }, [article?.slug, loading, slug])

    useEffect(() => {
        if (!article) return
        // Per-article OG/description + BlogPosting JSON-LD (wins over the
        // generic /blog payload — see lib/blogMeta.ts for the ordering contract).
        applyArticleHeadMeta(article, window.location.href)
        return clearArticleHeadMeta
    }, [article])

    useEffect(() => {
        if (article) return
        const previousTitle = document.title
        document.title = "Blog — Memba"
        return () => {
            if (document.title === "Blog — Memba") document.title = previousTitle
        }
    }, [article])

    if (!article) {
        return (
            <div id="blog-page" className="blog-shell">
                <nav className="news-section-nav" aria-label="News sections">
                    <Link to={`/${nk}/blog`} aria-current="page">Blog</Link>
                    <Link to={`/${nk}/changelogs`}>Changelogs</Link>
                </nav>
                <h1 ref={headingRef} tabIndex={-1} className="blog-title">{loading ? "Loading article" : "Article not found"}</h1>
                <p className="blog-empty" role={loading ? "status" : undefined}>
                    {loading ? "Checking for the latest post…" : "This article is unavailable."}
                </p>
                <Link to={`/${nk}/blog`} className="blog-back">← All articles</Link>
            </div>
        )
    }

    return (
        <article id="blog-page" className="blog-shell blog-article">
            <nav className="news-section-nav" aria-label="News sections">
                <Link to={`/${nk}/blog`} aria-current="page">Blog</Link>
                <Link to={`/${nk}/changelogs`}>Changelogs</Link>
            </nav>
            <Link to={`/${nk}/blog`} className="blog-back">
                <ArrowLeft size={13} aria-hidden="true" /> All articles
            </Link>
            <div className="blog-article__kicker">Memba · gno.land</div>
            <h1 ref={headingRef} tabIndex={-1} className="blog-title">{article.title}</h1>
            <div className="blog-meta">
                <span>Published {formatDate(article.date)}</span>
                {article.updated && <span>Updated {formatDate(article.updated)}</span>}
                <span aria-hidden="true">·</span>
                <span>{readingTime(article.body)}</span>
                {article.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
            </div>
            <div
                className="blog-body"
                data-testid="blog-body"
                dangerouslySetInnerHTML={{ __html: articleBodyHtml(article) }}
            />
        </article>
    )
}

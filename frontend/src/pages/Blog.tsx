/**
 * Blog — W6.4: article list + article view (/blog, /blog/:slug).
 *
 * Content: markdown files in content/blog/ (see lib/blogParser.ts for the
 * front-matter contract). Rendered with the XSS-safe markdownLite renderer
 * (escaped content, protocol-whitelisted links) + DOMPurify, matching the
 * house pattern for realm Render output.
 */
import { useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import DOMPurify from "dompurify"
import { Rss, ArrowLeft } from "@phosphor-icons/react"
import { useBlogArticles, useBlogArticle } from "../lib/blogSource"
import { renderMarkdown } from "../lib/markdownLite"
import { useNetworkKey } from "../hooks/useNetworkNav"
import "./blog.css"

function formatDate(date: string): string {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
    })
}

/** Rough reading time from the raw markdown body (~200 wpm). */
function readingTime(body: string): string {
    const words = body.trim().split(/\s+/).filter(Boolean).length
    return `${Math.max(1, Math.round(words / 200))} min read`
}

export function BlogList() {
    const nk = useNetworkKey()
    useEffect(() => { document.title = "Blog — Memba" }, [])

    const { articles } = useBlogArticles()
    const [featured, ...rest] = articles

    return (
        <div id="blog-page" className="blog-shell">
            {/* ── Masthead ─────────────────────────────────────── */}
            <header className="blog-masthead">
                <div className="blog-masthead__kicker">Memba · gno.land</div>
                <h1 className="blog-masthead__title">Blog</h1>
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
    const article = useBlogArticle(slug)

    useEffect(() => {
        document.title = article ? `${article.title} — Memba` : "Blog — Memba"
    }, [article])

    if (!article) {
        return (
            <div id="blog-page" className="blog-shell">
                <p className="blog-empty">Article not found.</p>
                <Link to={`/${nk}/blog`} className="blog-back">← All articles</Link>
            </div>
        )
    }

    return (
        <article id="blog-page" className="blog-shell blog-article">
            <Link to={`/${nk}/blog`} className="blog-back">
                <ArrowLeft size={13} aria-hidden="true" /> All articles
            </Link>
            <div className="blog-article__kicker">Memba · gno.land</div>
            <h1 className="blog-title">{article.title}</h1>
            <div className="blog-meta">
                <span>{formatDate(article.date)}</span>
                <span aria-hidden="true">·</span>
                <span>{readingTime(article.body)}</span>
                {article.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
            </div>
            <div
                className="blog-body"
                data-testid="blog-body"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(article.body)) }}
            />
        </article>
    )
}

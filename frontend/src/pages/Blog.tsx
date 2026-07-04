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
import { Newspaper } from "@phosphor-icons/react"
import { BLOG_ARTICLES, getArticle } from "../lib/blog"
import { renderMarkdown } from "../lib/markdownLite"
import { useNetworkKey } from "../hooks/useNetworkNav"
import "./blog.css"

function formatDate(date: string): string {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
    })
}

export function BlogList() {
    const nk = useNetworkKey()
    useEffect(() => { document.title = "Blog — Memba" }, [])

    return (
        <div id="blog-page" className="blog-shell">
            <div className="blog-header">
                <Newspaper size={22} color="var(--color-brand)" />
                <h2>Blog</h2>
            </div>
            <p className="blog-sub">Memba and gno.land ecosystem updates.</p>

            {BLOG_ARTICLES.length === 0 && (
                <p className="blog-empty">No articles yet.</p>
            )}

            {BLOG_ARTICLES.map(a => (
                <Link key={a.slug} to={`/${nk}/blog/${a.slug}`} className="blog-card" data-testid="blog-card">
                    <div className="blog-card__date">{formatDate(a.date)}</div>
                    <div className="blog-card__title">{a.title}</div>
                    <div className="blog-card__desc">{a.description}</div>
                    {a.tags.length > 0 && (
                        <div className="blog-card__tags">
                            {a.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
                        </div>
                    )}
                </Link>
            ))}
        </div>
    )
}

export function BlogArticlePage() {
    const { slug } = useParams<{ slug: string }>()
    const nk = useNetworkKey()
    const article = slug ? getArticle(slug) : undefined

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
        <div id="blog-page" className="blog-shell">
            <Link to={`/${nk}/blog`} className="blog-back">← All articles</Link>
            <h1 className="blog-title">{article.title}</h1>
            <div className="blog-meta">
                <span>{formatDate(article.date)}</span>
                {article.tags.map(t => <span key={t} className="blog-tag">{t}</span>)}
            </div>
            <div
                className="blog-body"
                data-testid="blog-body"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(article.body)) }}
            />
        </div>
    )
}

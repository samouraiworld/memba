/**
 * RealmDetailDrawer — Slide-in panel for exploring realm/package details.
 *
 * Three tabs:
 * 1. Render — Markdown-rendered Render() output
 * 2. Source — Syntax-highlighted source code with file tabs
 * 3. Info — File tree + function listing + dependencies
 *
 * Glassmorphic backdrop, Escape to close, responsive.
 *
 * @module components/directory/RealmDetailDrawer
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { GNO_RPC_URL } from "../../lib/config"
import { queryRender } from "../../lib/dao/shared"
import { getGnowebUrl } from "../../lib/gnoweb"
import { fetchRealmSource } from "../../lib/gnowebSource"
import type { RealmSource } from "../../lib/gnowebSource"
import { renderMarkdown } from "../../lib/markdownLite"
import { SourceCodeView } from "./SourceCodeView"
import { FileTree } from "./FileTree"
import { FunctionList } from "./FunctionList"

type DrawerTab = "render" | "source" | "info"

interface RealmDetailDrawerProps {
    /** Realm/package path, e.g. "gno.land/r/samcrew/memba_dao" */
    path: string
    /** Gnoweb URL (optional, derived from chain if not provided) */
    gnowebUrl?: string
    /** Whether this is a package (no Render tab) */
    isPackage?: boolean
    onClose: () => void
}

export function RealmDetailDrawer({ path, gnowebUrl, isPackage, onClose }: RealmDetailDrawerProps) {
    const [tab, setTab] = useState<DrawerTab>(isPackage ? "source" : "render")
    const [renderOutput, setRenderOutput] = useState<string | null>(null)
    const [renderLoading, setRenderLoading] = useState(false)
    const [source, setSource] = useState<RealmSource | null>(null)
    const [sourceLoading, setSourceLoading] = useState(false)
    const [sourceActiveFile, setSourceActiveFile] = useState<string>("")
    const [visible, setVisible] = useState(false)
    const drawerRef = useRef<HTMLDivElement>(null)

    // Animate in
    useEffect(() => {
        requestAnimationFrame(() => setVisible(true))
    }, [])

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose()
        }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleClose = useCallback(() => {
        setVisible(false)
        setTimeout(onClose, 250) // wait for animation
    }, [onClose])

    // Derive gnoweb URL from chain config if not provided
    const resolvedGnowebUrl = gnowebUrl || getGnowebUrl("gnoland1") || "https://gno.land"

    // Fetch Render() output
    useEffect(() => {
        if (isPackage) return
        setRenderLoading(true)
        queryRender(GNO_RPC_URL, path, "")
            .then(raw => setRenderOutput(raw || "No Render() output available."))
            .catch(() => setRenderOutput("Failed to fetch Render() output."))
            .finally(() => setRenderLoading(false))
    }, [path, isPackage])

    // Fetch source code
    useEffect(() => {
        setSourceLoading(true)
        // Convert "gno.land/r/samcrew/dao" to "/r/samcrew/dao"
        const realmPath = path.startsWith("gno.land") ? path.replace("gno.land", "") : path
        fetchRealmSource(resolvedGnowebUrl, realmPath)
            .then(src => {
                setSource(src)
                if (src?.files[0]) setSourceActiveFile(src.files[0].name)
            })
            .catch(() => setSource(null))
            .finally(() => setSourceLoading(false))
    }, [path, resolvedGnowebUrl])

    // Derive short name from path
    const shortName = path.split("/").pop() || path

    // External gnoweb link
    const gnowebLink = `${resolvedGnowebUrl}/${path.replace("gno.land/", "")}`

    return (
        <div
            className={`drawer-overlay${visible ? " visible" : ""}`}
            onClick={handleClose}
        >
            <div
                ref={drawerRef}
                className={`drawer-panel${visible ? " visible" : ""}`}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`${shortName} details`}
            >
                {/* Header */}
                <div className="drawer-header">
                    <div className="drawer-header__info">
                        <h2 className="drawer-header__title">{shortName}</h2>
                        <span className="drawer-header__path">{path}</span>
                    </div>
                    <button className="drawer-close" onClick={handleClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="drawer-tabs">
                    {!isPackage && (
                        <button
                            className={`drawer-tab${tab === "render" ? " active" : ""}`}
                            onClick={() => setTab("render")}
                        >
                            Render
                        </button>
                    )}
                    <button
                        className={`drawer-tab${tab === "source" ? " active" : ""}`}
                        onClick={() => setTab("source")}
                    >
                        Source
                    </button>
                    <button
                        className={`drawer-tab${tab === "info" ? " active" : ""}`}
                        onClick={() => setTab("info")}
                    >
                        Info
                    </button>
                </div>

                {/* Tab Content */}
                <div className="drawer-content">
                    {/* Render Tab */}
                    {tab === "render" && !isPackage && (
                        <div className="drawer-render">
                            {renderLoading ? (
                                <div className="drawer-skeleton">
                                    <div className="drawer-skeleton__line" style={{ width: "80%" }} />
                                    <div className="drawer-skeleton__line" style={{ width: "60%" }} />
                                    <div className="drawer-skeleton__line" style={{ width: "90%" }} />
                                    <div className="drawer-skeleton__line" style={{ width: "40%" }} />
                                </div>
                            ) : (
                                <div
                                    className="drawer-render__content"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(renderOutput || "") }}
                                />
                            )}
                        </div>
                    )}

                    {/* Source Tab */}
                    {tab === "source" && (
                        <div className="drawer-source">
                            {sourceLoading ? (
                                <div className="drawer-skeleton">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="drawer-skeleton__line drawer-skeleton__code"
                                            style={{ width: `${40 + Math.random() * 50}%` }}
                                        />
                                    ))}
                                </div>
                            ) : source && source.files.length > 0 ? (
                                <SourceCodeView
                                    files={source.files}
                                    activeFile={sourceActiveFile}
                                />
                            ) : (
                                <div className="drawer-empty">
                                    Source code not available. The gnoweb endpoint may be unreachable.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Info Tab */}
                    {tab === "info" && (
                        <div className="drawer-info">
                            {source ? (
                                <>
                                    <FileTree
                                        files={source.files}
                                        onFileClick={name => {
                                            setSourceActiveFile(name)
                                            setTab("source")
                                        }}
                                    />

                                    <FunctionList functions={source.functions} />

                                    {source.imports.length > 0 && (
                                        <div className="drawer-deps">
                                            <div className="drawer-deps__header">
                                                Dependencies ({source.imports.length})
                                            </div>
                                            <div className="drawer-deps__list">
                                                {source.imports.map(imp => (
                                                    <div key={imp} className="drawer-deps__item">{imp}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : sourceLoading ? (
                                <div className="drawer-skeleton">
                                    <div className="drawer-skeleton__line" style={{ width: "60%" }} />
                                    <div className="drawer-skeleton__line" style={{ width: "45%" }} />
                                </div>
                            ) : (
                                <div className="drawer-empty">
                                    Source metadata not available.
                                </div>
                            )}

                            {/* External links */}
                            <div className="drawer-links">
                                <a
                                    href={gnowebLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="drawer-links__item"
                                >
                                    Open in gnoweb →
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

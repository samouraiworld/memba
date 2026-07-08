/**
 * ExplorerTab — the read-only realm viewer, merged into the Directory as a tab.
 *
 * Formerly the standalone `/explorer/*` page (Wave 9 P0). Now one of the Directory
 * tabs so realm-discovery lives under a single feature: browse (Packages/Realms/…)
 * → deep-dive (Explorer). The active realm is carried in the Directory URL state
 * (`?tab=explorer&realm=r/x/y`) instead of a route splat, so it stays deep-linkable
 * and the browser back button walks realm history. Legacy `/explorer/*` links
 * redirect here (see pages/Explorer.tsx).
 *
 * Read-only-safe by construction: three ABCI queries only (`vm/qrender`,
 * `vm/qfile`, `vm/qfuncs`) — no `vm/qeval`, no execution surface (SEC-01).
 * Gated by VITE_ENABLE_EXPLORER (the Directory only renders this tab when on).
 *
 * @module components/directory/tabs/ExplorerTab
 */

import { useState, useEffect, useMemo, type FormEvent } from "react"
import DOMPurify from "dompurify"
import { GNO_RPC_URL } from "../../../lib/config"
import { queryRender } from "../../../lib/dao/shared"
import { getGnowebUrl } from "../../../lib/gnoweb"
import { useNetwork } from "../../../hooks/useNetwork"
import { fetchRealmSourceSmart, type RealmSource } from "../../../lib/gnowebSource"
import { renderMarkdown } from "../../../lib/markdownLite"
import { fetchRealmFuncs, formatSignature, resolveFnList, type GnoFunc } from "../../../lib/gnoFuncs"
import { toExplorerRelPath } from "../../../lib/explorerLink"
import { SourceCodeView } from "../SourceCodeView"
import "../../../pages/explorer.css"

type Tab = "render" | "source" | "functions"

const EXAMPLES = [
    "r/samcrew/memba_feed_v1",
    "r/gnops/valopers",
    "r/gnoland/users/v1",
]

/** Normalize any user input / URL value to a `gno.land/...` pkg path (or ""). */
function toRealmPath(raw: string): string {
    const rel = toExplorerRelPath(raw)
    return rel ? `gno.land/${rel}` : ""
}

interface ExplorerTabProps {
    /** Bare relpath (`r/x/y`) from Directory URL state; "" shows the examples. */
    realm: string
    /** Persist a new realm relpath to the Directory URL state. */
    onRealmChange: (relpath: string) => void
}

export function ExplorerTab({ realm, onRealmChange }: ExplorerTabProps) {
    const { networkKey } = useNetwork()
    const realmPath = useMemo(() => toRealmPath(realm), [realm])

    // Uncontrolled input keyed by `realm`: resets to the current path on change,
    // read via FormData on submit — no state-sync effect.
    const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const raw = new FormData(e.currentTarget).get("realm")?.toString() ?? ""
        const rel = toExplorerRelPath(raw)
        if (rel) onRealmChange(rel)
    }

    return (
        <div className="explorer" data-testid="explorer-root">
            <header className="explorer__head">
                <p className="explorer__sub">Read any realm on-chain — its live render, source, and functions.</p>
                <form className="explorer__search" onSubmit={submit}>
                    <span className="explorer__prefix">gno.land/</span>
                    <input
                        key={realm}
                        name="realm"
                        className="explorer__input"
                        defaultValue={toExplorerRelPath(realm)}
                        placeholder="r/samcrew/memba_feed_v1"
                        aria-label="Realm path"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <button className="explorer__go" type="submit">View</button>
                </form>
            </header>

            {realmPath ? (
                <RealmView key={realmPath} path={realmPath} networkKey={networkKey} />
            ) : (
                <div className="explorer__examples">
                    <span className="explorer__examples-label">Try:</span>
                    {EXAMPLES.map((ex) => (
                        <button
                            key={ex}
                            className="explorer__example"
                            onClick={() => onRealmChange(ex)}
                        >
                            {ex}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function RealmView({ path, networkKey }: { path: string; networkKey: string }) {
    const [tab, setTab] = useState<Tab>("render")
    const [render, setRender] = useState<string | null>(null)
    const [renderLoading, setRenderLoading] = useState(true)
    const [source, setSource] = useState<RealmSource | null>(null)
    const [sourceLoading, setSourceLoading] = useState(true)
    const [activeFile, setActiveFile] = useState("")
    const [funcs, setFuncs] = useState<GnoFunc[] | null>(null)

    const gnowebUrl = getGnowebUrl(networkKey) || "https://gno.land"
    const relPath = path.replace(/^gno\.land/, "")
    const shortName = path.split("/").pop() || path

    // RealmView is keyed by realmPath (remounts per realm), so the initial
    // loading=true state is fresh each time — no synchronous setState in-effect.
    useEffect(() => {
        queryRender(GNO_RPC_URL, path, "")
            .then((raw) => setRender(raw))
            .catch(() => setRender(null))
            .finally(() => setRenderLoading(false))
    }, [path])

    useEffect(() => {
        fetchRealmSourceSmart(gnowebUrl, relPath)
            .then((src) => {
                setSource(src)
                if (src?.files[0]) setActiveFile(src.files[0].name)
            })
            .catch(() => setSource(null))
            .finally(() => setSourceLoading(false))
    }, [path, relPath, gnowebUrl])

    useEffect(() => {
        fetchRealmFuncs(relPath)
            .then(setFuncs)
            .catch(() => setFuncs([]))
    }, [relPath])

    // Authoritative qfuncs signatures; fall back to the source parser's exported
    // names (resolveFnList owns the precedence — unit-tested in gnoFuncs.test).
    const fnList: GnoFunc[] = useMemo(
        () => resolveFnList(funcs, (source?.functions ?? []).filter((f) => f.isExported).map((f) => f.name)),
        [funcs, source],
    )

    return (
        <section className="realmview">
            <div className="realmview__bar">
                <h2 className="realmview__name">{shortName}</h2>
                <code className="realmview__path">{path}</code>
                <a className="realmview__gnoweb" href={`${gnowebUrl}${relPath}`} target="_blank" rel="noopener noreferrer">
                    gnoweb ↗
                </a>
            </div>

            <div className="realmview__tabs" role="tablist">
                {(["render", "source", "functions"] as Tab[]).map((t) => (
                    <button
                        key={t}
                        role="tab"
                        aria-selected={tab === t}
                        className={`realmview__tab${tab === t ? " active" : ""}`}
                        onClick={() => setTab(t)}
                    >
                        {t[0].toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            <div className="realmview__body">
                {tab === "render" && (
                    renderLoading ? (
                        <p className="realmview__muted">Loading render…</p>
                    ) : render ? (
                        <div
                            className="realmview__render"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(render)) }}
                        />
                    ) : (
                        <p className="realmview__muted">This realm has no <code>Render()</code> output (or it could not be reached).</p>
                    )
                )}

                {tab === "source" && (
                    sourceLoading ? (
                        <p className="realmview__muted">Loading source…</p>
                    ) : source && source.files.length > 0 ? (
                        <>
                            <div className="realmview__sourcehint">
                                <span>Read-only view. Copy a file and experiment in the sandbox:</span>
                                <a
                                    className="realmview__playground"
                                    href="https://play.gno.land"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Open Playground ↗
                                </a>
                            </div>
                            <SourceCodeView files={source.files} activeFile={activeFile} />
                        </>
                    ) : (
                        <p className="realmview__muted">Source unavailable — the chain RPC and gnoweb could not be reached.</p>
                    )
                )}

                {tab === "functions" && (
                    // Still loading while qfuncs is in flight, OR qfuncs came back
                    // empty but the source-parser fallback hasn't resolved yet —
                    // otherwise the tab flashes "no functions" before the fallback.
                    funcs === null || (fnList.length === 0 && sourceLoading) ? (
                        <p className="realmview__muted">Loading functions…</p>
                    ) : fnList.length > 0 ? (
                        <ul className="realmview__funcs">
                            {fnList.map((fn) => (
                                <li key={fn.name} className="realmview__func">
                                    <code>{formatSignature(fn)}</code>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="realmview__muted">No exported functions found.</p>
                    )
                )}
            </div>
        </section>
    )
}

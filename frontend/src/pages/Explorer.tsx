/**
 * Explorer — universal read-only realm viewer at `/explorer/*` (Wave 9 P0).
 *
 * Deep-linkable: `/explorer/r/samcrew/memba_feed_v1` shows any realm's live
 * Render, Source, and exported Functions. Three read-only ABCI queries only
 * (`vm/qrender`, `vm/qfile`, `vm/qfuncs`) — no `vm/qeval`, no execution surface
 * (SEC-01), so it is read-only-safe by construction. Behind `VITE_ENABLE_EXPLORER`.
 *
 * @module pages/Explorer
 */

import { useState, useEffect, useMemo, type FormEvent } from "react"
import { useParams, useNavigate } from "react-router-dom"
import DOMPurify from "dompurify"
import { GNO_RPC_URL } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import { getGnowebUrl } from "../lib/gnoweb"
import { useNetwork } from "../hooks/useNetwork"
import { fetchRealmSourceSmart, type RealmSource } from "../lib/gnowebSource"
import { renderMarkdown } from "../lib/markdownLite"
import { fetchRealmFuncs, formatSignature, type GnoFunc } from "../lib/gnoFuncs"
import { SourceCodeView } from "../components/directory/SourceCodeView"
import "./explorer.css"

type Tab = "render" | "source" | "functions"

const EXAMPLES = [
    "r/samcrew/memba_feed_v1",
    "r/gnops/valopers",
    "r/gnoland/users/v1",
]

/** Normalize any user input / URL splat to a `gno.land/...` pkg path (or ""). */
function toRealmPath(raw: string): string {
    let p = (raw || "").trim().replace(/^https?:\/\/[^/]+/, "")
    p = p.replace(/^gno\.land/, "").replace(/^\/+/, "").replace(/\/+$/, "")
    return p ? `gno.land/${p}` : ""
}

export function Explorer() {
    const { networkKey } = useNetwork()
    const navigate = useNavigate()
    const splat = useParams()["*"] || ""
    const realmPath = useMemo(() => toRealmPath(splat), [splat])

    // Uncontrolled input keyed by splat: it resets to the current path on
    // navigation, and we read it via FormData on submit — no state-sync effect.
    const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const raw = new FormData(e.currentTarget).get("realm")?.toString() ?? ""
        const p = toRealmPath(raw)
        if (p) navigate(`/${networkKey}/explorer/${p.replace(/^gno\.land\//, "")}`)
    }

    return (
        <div className="explorer" data-testid="explorer-root">
            <header className="explorer__head">
                <h1 className="explorer__title">Explorer</h1>
                <p className="explorer__sub">Read any realm on-chain — its live render, source, and functions.</p>
                <form className="explorer__search" onSubmit={submit}>
                    <span className="explorer__prefix">gno.land/</span>
                    <input
                        key={splat}
                        name="realm"
                        className="explorer__input"
                        defaultValue={splat.replace(/^gno\.land\//, "")}
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
                            onClick={() => navigate(`/${networkKey}/explorer/${ex}`)}
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

    // Authoritative qfuncs signatures; fall back to the source parser's list.
    const fnList: GnoFunc[] = useMemo(() => {
        if (funcs && funcs.length > 0) return funcs
        return (source?.functions ?? [])
            .filter((f) => f.isExported)
            .map((f) => ({ name: f.name, params: [], results: [] }))
    }, [funcs, source])

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
                        <SourceCodeView files={source.files} activeFile={activeFile} />
                    ) : (
                        <p className="realmview__muted">Source unavailable — the chain RPC and gnoweb could not be reached.</p>
                    )
                )}

                {tab === "functions" && (
                    funcs === null ? (
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

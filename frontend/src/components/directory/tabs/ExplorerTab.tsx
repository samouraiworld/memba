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

import { useState, useMemo, type FormEvent } from "react"
import { sanitizeMarkdownHtml } from "../../../lib/sanitizeMarkdownHtml"
import { getExplorerBaseUrlFor } from "../../../lib/config"
import { useQuery } from "@tanstack/react-query"
import { useDirectoryRender } from "../../../hooks/useDirectoryRender"
import { useNetwork } from "../../../hooks/useNetwork"
import { useTabListKeyboard } from "../../../hooks/useTabListKeyboard"
import { fetchRealmSourceSmart } from "../../../lib/gnowebSource"
import { renderMarkdown } from "../../../lib/markdownLite"
import { fetchRealmFuncs, formatSignature, resolveFnList, type GnoFunc } from "../../../lib/gnoFuncs"
import { toExplorerRelPath } from "../../../lib/explorerLink"
import { SourceCodeView } from "../SourceCodeView"
import { directorySeeds } from "../../../lib/directorySeeds"
import "../../../pages/explorer.css"

type Tab = "render" | "source" | "functions"

// Tab keys in display order — shared by the tablist markup and the keyboard
// hook. Prefixed ids: this tablist renders inside Directory's own tab panel,
// whose tabs use the hook's default `tab-*` ids.
const REALM_TAB_KEYS: readonly Tab[] = ["render", "source", "functions"]

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
                        placeholder="r/gov/dao"
                        aria-label="Realm path"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <button className="explorer__go" type="submit">View</button>
                </form>
            </header>

            {realmPath ? (
                <RealmView key={`${networkKey}:${realmPath}`} path={realmPath} networkKey={networkKey} />
            ) : (
                <div className="explorer__examples">
                    <span className="explorer__examples-label">Try:</span>
                    {directorySeeds(networkKey).realms.slice(0, 3).map(item => toExplorerRelPath(item.path)).map((ex) => (
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
    const isPackage = toExplorerRelPath(path).startsWith("p/")
    const [tab, setTab] = useState<Tab>(isPackage ? "source" : "render")
    const tabs = isPackage ? REALM_TAB_KEYS.filter(key => key !== "render") : REALM_TAB_KEYS

    // APG tabs keyboard contract (roving tabindex, arrows, Home/End) — the
    // shared hook Directory extracted; these tabs had no keyboard support.
    const { tabProps } = useTabListKeyboard<Tab>({
        keys: tabs,
        active: tab,
        onSelect: setTab,
        idFor: (k) => `realmview-tab-${k}`,
    })
    const gnowebUrl = getExplorerBaseUrlFor(networkKey)
    const relPath = path.replace(/^gno\.land/, "")
    const shortName = path.split("/").pop() || path
    const renderQuery = useDirectoryRender(isPackage ? null : path)
    const render = renderQuery.data
    const renderLoading = renderQuery.loading
    const sourceQuery = useQuery({
        queryKey: ["realm", "source", networkKey, path, gnowebUrl],
        queryFn: () => fetchRealmSourceSmart(gnowebUrl, relPath),
        retry: false, refetchOnWindowFocus: false,
    })
    const source = sourceQuery.data
    const sourceLoading = sourceQuery.isFetching
    const activeFile = source?.files[0]?.name ?? ""
    const funcsQuery = useQuery({
        queryKey: ["realm", "functions", networkKey, path],
        queryFn: () => fetchRealmFuncs(relPath),
        retry: false, refetchOnWindowFocus: false,
    })
    const funcs = funcsQuery.data ?? null
    const sourceNames = useMemo(
        () => (source?.functions ?? []).filter((f) => f.isExported).map((f) => f.name),
        [source],
    )
    const usingSourceNames = !funcs?.length && sourceNames.length > 0

    // Authoritative qfuncs signatures; fall back to the source parser's exported
    // names (resolveFnList owns the precedence — unit-tested in gnoFuncs.test).
    const fnList: GnoFunc[] = useMemo(
        () => resolveFnList(funcs, sourceNames),
        [funcs, sourceNames],
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

            <div className="realmview__tabs" role="tablist" aria-label="Realm views">
                {tabs.map((t) => (
                    <button
                        key={t}
                        {...tabProps(t)}
                        className={`realmview__tab${tab === t ? " active" : ""}`}
                        onClick={() => setTab(t)}
                    >
                        {t[0].toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            <div className="realmview__body" role="tabpanel" aria-labelledby={`realmview-tab-${tab}`} tabIndex={0}>
                {tab === "render" && (
                    renderLoading ? (
                        <p className="realmview__muted">Loading render…</p>
                    ) : renderQuery.isError ? (
                        <p className="realmview__muted" role="status">Could not read this realm’s Render output. <button className="explorer__go" onClick={() => void renderQuery.refetch()}>Retry render</button></p>
                    ) : render ? (
                        <div
                            className="realmview__render"
                            dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(renderMarkdown(render)) }}
                        />
                    ) : (
                        <p className="realmview__muted">This realm returned no <code>Render()</code> output.</p>
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
                        <p className="realmview__muted" role="status">Source unavailable for this path. <button className="explorer__go" onClick={() => void sourceQuery.refetch()}>Retry source</button></p>
                    )
                )}

                {tab === "functions" && (
                    // Still loading while qfuncs is in flight, OR qfuncs came back
                    // empty but the source-parser fallback hasn't resolved yet —
                    // otherwise the tab flashes "no functions" before the fallback.
                    funcsQuery.isFetching || (fnList.length === 0 && sourceLoading) ? (
                        <p className="realmview__muted">Loading functions…</p>
                    ) : fnList.length > 0 ? (
                        <>
                            {funcsQuery.isError && (
                                <p className="realmview__muted" role="status">
                                    {funcs?.length ? "Could not refresh functions; showing previously loaded signatures." : "Function query unavailable."}
                                    {" "}<button className="explorer__go" onClick={() => void funcsQuery.refetch()}>Retry functions</button>
                                </p>
                            )}
                            {usingSourceNames && (
                                <p className="realmview__muted" role="status">
                                    Function names from source; signatures unavailable.
                                </p>
                            )}
                            <ul className="realmview__funcs">
                                {fnList.map((fn) => (
                                    <li key={fn.name} className="realmview__func">
                                        <code>{usingSourceNames ? fn.name : formatSignature(fn)}</code>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : funcsQuery.isError ? (
                        <p className="realmview__muted" role="status">Functions could not be read. <button className="explorer__go" onClick={() => void funcsQuery.refetch()}>Retry functions</button></p>
                    ) : (
                        <p className="realmview__muted">No exported functions found.</p>
                    )
                )}
            </div>
        </section>
    )
}

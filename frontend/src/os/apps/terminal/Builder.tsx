import { useRef, useState } from "react"
import { validateRealmPath } from "../../../lib/templates/sanitizer"
import { CodeEditor, MAX_SOURCE_BYTES } from "./CodeEditor"

const START = `package hello

// Render is the public page for your realm.
func Render(path string) string {
    return "Hello from Gno."
}
`

interface Draft { path: string; source: string }

function readDraft(key: string, address: string): Draft {
    const fresh = { path: `gno.land/r/${address || "yourname"}/hello`, source: START }
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null")
        if (!stored || typeof stored !== "object") return fresh
        const draft = stored as Record<string, unknown>
        if (typeof draft.path !== "string" || draft.path.length > 180 || typeof draft.source !== "string" || new TextEncoder().encode(draft.source).length > MAX_SOURCE_BYTES) return fresh
        return { path: draft.path, source: draft.source }
    } catch { return fresh }
}

export function Builder({ chainId, address }: { chainId: string; address: string }) {
    const key = `memba_os_terminal_draft:${chainId}:${address || "guest"}`
    const [draft, setDraft] = useState(() => readDraft(key, address))
    const draftRef = useRef(draft)
    const [storageError, setStorageError] = useState(false)
    const [importError, setImportError] = useState("")
    const fileInput = useRef<HTMLInputElement>(null)
    const pathError = validateRealmPath(draft.path)
    const packageName = draft.path.split("/").at(-1) ?? ""
    const declaration = /^(?:(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*package\s+([a-z][a-z0-9_]*)\b/.exec(draft.source)?.[1]
    const sourceBytes = new TextEncoder().encode(draft.source).length
    const sourceError = !draft.source.trim() ? "Write some Gno source first."
        : declaration !== packageName ? `The source must declare package ${packageName || "<realm name>"}.` : null

    const update = (patch: Partial<Draft>) => {
        if (patch.source !== undefined) {
            if (new TextEncoder().encode(patch.source).length > MAX_SOURCE_BYTES) {
                setImportError("Keep this small package below 32 KB.")
                return
            }
            setImportError("")
        }
        const next = { ...draftRef.current, ...patch }
        draftRef.current = next
        setDraft(next)
        try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(false) }
        catch { setStorageError(true) }
    }

    const exportSource = () => {
        const url = URL.createObjectURL(new Blob([draft.source], { type: "text/plain;charset=utf-8" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `${packageName || "realm"}.gno`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    const importSource = async (file: File | undefined) => {
        if (!file) return
        if (file.size > MAX_SOURCE_BYTES) { setImportError("Choose a .gno file below 32 KB."); return }
        try { update({ source: await file.text() }) }
        catch { setImportError("Could not read that file. Try again.") }
    }

    return (
        <div className="os-terminal-builder">
            <div className="os-terminal-builder-head">
                <div><h2>Build a realm</h2><p>One Gno file, saved only in this browser. Source is public and permanent when deployed.</p></div>
                <span className="os-terminal-save" role="status">{storageError ? "Could not save locally" : "Saved locally"}</span>
            </div>
            <div className="os-terminal-path">
                <label htmlFor="os-terminal-realm-path">Realm path</label>
                <input id="os-terminal-realm-path" className="os-in os-mono" value={draft.path} onChange={(e) => update({ path: e.target.value })}
                    maxLength={180} spellCheck={false} autoComplete="off" aria-invalid={!!pathError} aria-describedby={pathError ? "os-terminal-path-error" : undefined} />
                {pathError && <span id="os-terminal-path-error" className="os-terminal-validation">{pathError}</span>}
            </div>
            <div className="os-terminal-file-bar"><span>{packageName || "hello"}.gno</span><span>Gno source</span></div>
            <CodeEditor value={draft.source} onChange={(source) => update({ source })} onLimit={() => setImportError("Keep this small package below 32 KB.")} />
            <div className="os-terminal-builder-foot">
                <span className={sourceError || importError ? "os-terminal-validation" : "os-sub"}>{importError || sourceError || `${sourceBytes.toLocaleString()} bytes · no local execution in this version`}</span>
                <input ref={fileInput} className="os-terminal-file-input" type="file" accept=".gno,text/plain" tabIndex={-1}
                    onChange={(e) => { void importSource(e.target.files?.[0]); e.target.value = "" }} />
                <button type="button" className="os-btn os-quiet" onClick={() => fileInput.current?.click()}>Import .gno</button>
                <button type="button" className="os-btn os-quiet" onClick={exportSource}>Export .gno</button>
                <button type="button" className="os-btn os-quiet" onClick={() => {
                    if (window.confirm("Replace your saved draft with the starter example?")) update({ source: START })
                }}>Reset example</button>
            </div>
        </div>
    )
}

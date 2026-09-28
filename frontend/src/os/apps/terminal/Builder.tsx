import { useEffect, useRef, useState } from "react"
import { validateRealmPath } from "../../../lib/templates/sanitizer"
import { CodeEditor, MAX_SOURCE_BYTES } from "./CodeEditor"

const START = `package hello

// Render is the public page for your realm.
func Render(path string) string {
    return "Hello from Gno."
}
`

interface Draft { path: string; source: string }

function declaredPackage(source: string): string | null {
    let offset = 0
    while (offset < source.length) {
        while (offset < source.length && /\s/.test(source[offset])) offset++
        if (source.startsWith("//", offset)) {
            const end = source.indexOf("\n", offset + 2)
            if (end < 0) return null
            offset = end + 1
            continue
        }
        if (source.startsWith("/*", offset)) {
            const end = source.indexOf("*/", offset + 2)
            if (end < 0) return null
            offset = end + 2
            continue
        }
        break
    }
    return /^package[ \t]+([a-z][a-z0-9_]*)\b/.exec(source.slice(offset))?.[1] ?? null
}

function starterDraft(address: string): Draft {
    return { path: `gno.land/r/${address || "yourname"}/hello`, source: START }
}

function parseDraft(raw: string | null, address: string): Draft {
    const fresh = starterDraft(address)
    try {
        const stored: unknown = JSON.parse(raw ?? "null")
        if (!stored || typeof stored !== "object") return fresh
        const draft = stored as Record<string, unknown>
        if (typeof draft.path !== "string" || draft.path.length > 180 || typeof draft.source !== "string" || new TextEncoder().encode(draft.source).length > MAX_SOURCE_BYTES) return fresh
        return { path: draft.path, source: draft.source }
    } catch { return fresh }
}

function readDraft(key: string, address: string): { draft: Draft; raw: string | null; failed: boolean } {
    try {
        const raw = localStorage.getItem(key)
        return { draft: parseDraft(raw, address), raw, failed: false }
    } catch { return { draft: starterDraft(address), raw: null, failed: true } }
}

export function Builder({ chainId, address }: { chainId: string; address: string }) {
    const key = `memba_os_terminal_draft:${chainId}:${address || "guest"}`
    const [initial] = useState(() => readDraft(key, address))
    const [draft, setDraft] = useState(initial.draft)
    const draftRef = useRef(draft)
    const lastStoredRaw = useRef(initial.raw)
    const conflictRef = useRef(false)
    const [conflict, setConflict] = useState(false)
    const [storageError, setStorageError] = useState(initial.failed)
    const storageErrorRef = useRef(initial.failed)
    const [importError, setImportError] = useState("")
    const fileInput = useRef<HTMLInputElement>(null)
    const pathError = validateRealmPath(draft.path)
    const packageName = draft.path.split("/").at(-1) ?? ""
    const declaration = declaredPackage(draft.source)
    const sourceBytes = new TextEncoder().encode(draft.source).length
    const sourceError = !draft.source.trim() ? "Write some Gno source first."
        : declaration !== packageName ? `The source must declare package ${packageName || "<realm name>"}.` : null

    useEffect(() => {
        const syncCurrent = () => {
            let raw: string | null
            try { raw = localStorage.getItem(key) } catch { return }
            if (conflictRef.current || raw === lastStoredRaw.current) return
            if (storageErrorRef.current) {
                conflictRef.current = true
                setConflict(true)
                return
            }
            lastStoredRaw.current = raw
            const incoming = parseDraft(raw, address)
            draftRef.current = incoming
            setDraft(incoming)
        }
        const onStorage = (event: StorageEvent) => {
            if (event.storageArea !== localStorage || event.key !== key) return
            // Read the current value: an older queued event may arrive after a
            // newer write was already observed during mount.
            syncCurrent()
        }
        window.addEventListener("storage", onStorage)
        // A write can land after the render-time read but before this listener
        // is installed. Reconcile after subscribing so it cannot be lost.
        syncCurrent()
        return () => window.removeEventListener("storage", onStorage)
    }, [key, address])

    const markStorageError = (failed: boolean) => {
        storageErrorRef.current = failed
        setStorageError(failed)
    }

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
        if (conflictRef.current) return
        try {
            if (localStorage.getItem(key) !== lastStoredRaw.current) {
                conflictRef.current = true
                setConflict(true)
                return
            }
            const raw = JSON.stringify(next)
            localStorage.setItem(key, raw)
            lastStoredRaw.current = raw
            markStorageError(false)
        }
        catch { markStorageError(true) }
    }

    const loadOtherTab = () => {
        try {
            const incoming = readDraft(key, address)
            if (incoming.failed) { markStorageError(true); return }
            lastStoredRaw.current = incoming.raw
            draftRef.current = incoming.draft
            setDraft(incoming.draft)
            conflictRef.current = false
            setConflict(false)
            markStorageError(false)
            setImportError("")
        } catch { markStorageError(true) }
    }

    const replaceOtherTab = () => {
        try {
            const raw = JSON.stringify(draftRef.current)
            localStorage.setItem(key, raw)
            lastStoredRaw.current = raw
            conflictRef.current = false
            setConflict(false)
            markStorageError(false)
        } catch { markStorageError(true) }
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
                <span className="os-terminal-save" role="status">{conflict ? "Edits in this tab are unsaved" : storageError ? "Could not save locally" : "Saved locally"}</span>
            </div>
            {conflict && <div className="os-terminal-conflict" role="alert">
                <span>This draft changed in another tab. Your edits here are unsaved.</span>
                <button type="button" className="os-btn os-quiet" onClick={loadOtherTab}>Load other tab</button>
                <button type="button" className="os-btn os-quiet" onClick={replaceOtherTab}>Replace other tab</button>
            </div>}
            <div className="os-terminal-path">
                <label htmlFor="os-terminal-realm-path">Realm path</label>
                <input id="os-terminal-realm-path" className="os-in os-mono" value={draft.path} onChange={(e) => update({ path: e.target.value })}
                    maxLength={180} spellCheck={false} autoComplete="off" aria-invalid={!!pathError} aria-describedby={pathError ? "os-terminal-path-error" : undefined} />
                {pathError && <span id="os-terminal-path-error" className="os-terminal-validation">{pathError}</span>}
            </div>
            <div className="os-terminal-file-bar"><span>{packageName || "hello"}.gno</span><span>Gno source</span></div>
            <CodeEditor value={draft.source} onChange={(source) => update({ source })} onLimit={() => setImportError("Keep this small package below 32 KB.")}
                invalid={!!(sourceError || importError)} descriptionId="os-terminal-source-status" />
            <div className="os-terminal-builder-foot">
                <span id="os-terminal-source-status" role={sourceError || importError ? "status" : undefined}
                    className={sourceError || importError ? "os-terminal-validation" : "os-sub"}>{importError || sourceError || `${sourceBytes.toLocaleString()} bytes · no local execution in this version`}</span>
                <input ref={fileInput} className="os-terminal-file-input" type="file" accept=".gno,text/plain" tabIndex={-1}
                    onChange={(e) => { void importSource(e.target.files?.[0]); e.target.value = "" }} />
                <button type="button" className="os-btn os-quiet" onClick={() => fileInput.current?.click()}>Import .gno</button>
                <button type="button" className="os-btn os-quiet" onClick={exportSource}>Export .gno</button>
                <a className="os-btn os-quiet" href="https://github.com/samouraiworld/peerdev/tree/main/gno-tutorials/short-tutorials/6-deploy-pkg"
                    target="_blank" rel="noopener noreferrer">How to deploy ↗</a>
                <button type="button" className="os-btn os-quiet" onClick={() => {
                    if (window.confirm("Replace your saved draft with the starter example?")) update(starterDraft(address))
                }}>Reset example</button>
            </div>
        </div>
    )
}

import { lazy, Suspense, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { NativeViewProps } from "../../native/types"
import { HELP, runReadCommand } from "./commands"
import "./terminal.css"

const Builder = lazy(() => import("./Builder").then((module) => ({ default: module.Builder })))

type Entry = { id: number; command: string; output: string; state: "ok" | "error" }

export default function TerminalWindow({ section, session, openApp, fallback }: NativeViewProps) {
    const [tab, setTab] = useState<"explore" | "build">("explore")
    const [command, setCommand] = useState("")
    const [entries, setEntries] = useState<Entry[]>([])
    const [busy, setBusy] = useState(false)
    const sequence = useRef(0)
    const history = useRef<string[]>([])
    const historyIndex = useRef(0)
    const scratchCommand = useRef("")
    const input = useRef<HTMLInputElement>(null)
    const output = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (tab === "explore" && output.current) output.current.scrollTop = output.current.scrollHeight
    }, [entries, tab])
    if (section !== null) return <>{fallback}</>

    function navigateHistory(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        if (!history.current.length) return
        event.preventDefault()
        if (event.key === "ArrowUp" && historyIndex.current === history.current.length) scratchCommand.current = command
        historyIndex.current = Math.max(0, Math.min(history.current.length,
            historyIndex.current + (event.key === "ArrowUp" ? -1 : 1)))
        setCommand(history.current[historyIndex.current] ?? scratchCommand.current)
    }

    async function submit(event: FormEvent) {
        event.preventDefault()
        const line = command.trim()
        if (!line || busy) return
        if (history.current.at(-1) !== line) history.current = [...history.current.slice(-49), line]
        historyIndex.current = history.current.length
        scratchCommand.current = ""
        setCommand("")
        if (line === "clear") { setEntries([]); return }
        setBusy(true)
        const id = ++sequence.current
        try {
            const result = await runReadCommand(line)
            setEntries((old) => [...old.slice(-19), { id, command: line, output: result, state: "ok" }])
        } catch (error) {
            setEntries((old) => [...old.slice(-19), { id, command: line, output: (error instanceof Error ? error.message : "The query failed. Try again.").slice(0, 1000), state: "error" }])
        } finally {
            setBusy(false)
            requestAnimationFrame(() => input.current?.focus())
        }
    }

    return (
        <div className="os-terminal">
            <nav className="os-terminal-tabs" aria-label="Terminal sections">
                <button type="button" aria-current={tab === "explore" ? "page" : undefined} onClick={() => setTab("explore")}>Explore</button>
                <button type="button" aria-current={tab === "build" ? "page" : undefined} onClick={() => setTab("build")}>Build draft</button>
                <button type="button" onClick={() => openApp("learn")}>Learn</button>
            </nav>
            {tab === "build" ? <Suspense fallback={<div className="os-terminal-builder-loading" role="status">Opening editor…</div>}>
                <Builder key={`${session.network.chainId}:${session.address || "guest"}`} chainId={session.network.chainId} address={session.address} />
            </Suspense> : <>
                <header className="os-terminal-header">
                    <div><h2>Terminal</h2><p>Explore packages and on-chain state with Gno queries.</p></div>
                    <div className="os-terminal-context" aria-label="Terminal context"><span>{session.network.chainId}</span><span>read-only</span></div>
                </header>
                <div className="os-terminal-console" ref={output} role="log" aria-label="Terminal output" aria-live="polite">
                    {entries.length === 0 && <pre className="os-terminal-intro">{HELP}</pre>}
                    {entries.length === 20 && <p className="os-terminal-history-note">Showing the latest 20 results.</p>}
                    {entries.map((entry) => <div className="os-terminal-entry" key={entry.id}>
                        <div className="os-terminal-command"><span aria-hidden="true">›</span> {entry.command}</div>
                        <pre className={entry.state === "error" ? "os-terminal-error" : undefined}>{entry.output}</pre>
                    </div>)}
                    {busy && <p className="os-terminal-working" role="status">Reading {session.network.chainId}…</p>}
                </div>
                <form className="os-terminal-prompt" onSubmit={(event) => { void submit(event) }}>
                    <label htmlFor="os-terminal-input">Command</label><span aria-hidden="true">›</span>
                    <input id="os-terminal-input" ref={input} value={command} onChange={(event) => setCommand(event.target.value)}
                        maxLength={2_000} autoComplete="off" autoCapitalize="off" spellCheck={false}
                        onKeyDown={navigateHistory} placeholder="Type help or render r/gov/dao" />
                    <button type="submit" disabled={busy || !command.trim()}>Run query</button>
                </form>
            </>}
        </div>
    )
}

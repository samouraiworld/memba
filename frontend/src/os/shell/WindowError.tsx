/**
 * Error boundary for one window's body. A window whose code fails to load (a stale
 * chunk after a deploy, a network blip) or whose page crashes shows the failure
 * inside itself; the other windows and the desktop keep working.
 *
 * @module os/shell/WindowError
 */
import { Component, type ErrorInfo, type ReactNode } from "react"
import * as Sentry from "@sentry/react"
import { isStaleChunkError, tryChunkReload } from "../../lib/staleChunk"
import { ThingTile } from "./icons"

interface Props {
    /** Changes when the window shows something else; clears a previous error. */
    resetKey: string
    /** Offers "Close window" when set; a boundary inside a window (an AppShell section) has none. */
    close?: () => void
    children: ReactNode
}

interface State {
    error: Error | null
    resetKey: string
}

export class WindowError extends Component<Props, State> {
    state: State = { error: null, resetKey: this.props.resetKey }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error }
    }

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        const stale = isStaleChunkError(error)
        Sentry.captureException(error, {
            tags: { memba_boundary: "os-window", memba_stale_chunk: stale ? "yes" : "no" },
            contexts: { react: { componentStack: info.componentStack } },
        })
        // Same once-per-session budget as the root boundary; never during a wallet request.
        if (stale) tryChunkReload()
    }

    render() {
        const { error } = this.state
        if (!error) return this.props.children
        // React.lazy keeps a failed import, so only a page reload can fetch the code again.
        const stale = isStaleChunkError(error)
        return (
            <div className="os-holding" role="alert">
                <ThingTile icon="doc" size={44} />
                <div className="os-holding-title">{stale ? "This window could not load" : "Something went wrong in this window"}</div>
                <p className="os-sub">
                    {stale
                        ? "Part of Memba could not load. Check your connection, then reload Memba. Your other windows are fine."
                        : this.props.close ? "Your other windows are fine. Try again, or close this window." : "Your other windows are fine. Try again."}
                </p>
                <div className="os-row">
                    {stale
                        ? <button type="button" className="os-btn" onClick={() => window.location.reload()}>Reload Memba</button>
                        : <button type="button" className="os-btn" onClick={() => this.setState({ error: null })}>Try again</button>}
                    {this.props.close && <button type="button" className="os-btn os-quiet" onClick={this.props.close}>Close window</button>}
                </div>
            </div>
        )
    }
}

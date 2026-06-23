/**
 * StateBoard — responsive grid wrapper for home status panels.
 *
 * Responsibilities (panel-agnostic):
 *   1. Grid layout: repeat(auto-fit, minmax(220px, 1fr))
 *   2. Per-panel error isolation via PanelBoundary (class ErrorBoundary)
 *   3. Lazy-mount for below-the-fold panels via useInViewport (IntersectionObserver)
 *
 * Panel contract:
 *   - Pass children as <SomePanel /> nodes
 *   - Wrap each child in <PanelSlot eager?> — or let StateBoard do it automatically
 *   - `eager` panels mount immediately (above-the-fold); omit for lazy-mount
 *
 * @module components/home/StateBoard
 */

import React from "react"
import { ActionCard } from "./ActionCard"
import { useInViewport } from "../../hooks/home/useInViewport"
import "./home.css"

// ── Per-panel error boundary ─────────────────────────────────────────────

interface PanelBoundaryState {
    hasError: boolean
}

/**
 * PanelBoundary — catches render errors thrown by a single panel.
 * Renders a compact neutral "couldn't load" ActionCard as fallback,
 * with a Retry button that clears the error state so the child re-mounts.
 * Sibling panels are unaffected.
 */
export class PanelBoundary extends React.Component<
    React.PropsWithChildren<{ label?: string }>,
    PanelBoundaryState
> {
    constructor(props: React.PropsWithChildren<{ label?: string }>) {
        super(props)
        this.state = { hasError: false }
        this.handleRetry = this.handleRetry.bind(this)
    }

    static getDerivedStateFromError(): PanelBoundaryState {
        return { hasError: true }
    }

    override componentDidCatch(error: Error) {
        // Intentionally minimal — panels are expected to self-degrade (show "—")
        // rather than throw. Log only in dev to avoid noise in prod.
        if (import.meta.env.DEV) {
            console.warn("[PanelBoundary] panel threw during render:", error)
        }
    }

    handleRetry() {
        this.setState({ hasError: false })
    }

    override render() {
        if (this.state.hasError) {
            return (
                <div data-testid="panel-boundary-fallback">
                    <ActionCard
                        accent="neutral"
                        eyebrow="panel"
                        title={this.props.label ?? "couldn't load"}
                        meta="—"
                    />
                    <button
                        className="panel-boundary__retry"
                        onClick={this.handleRetry}
                        data-testid="panel-boundary-retry"
                    >
                        Retry
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}

// ── Lazy-mount via IntersectionObserver ──────────────────────────────────
// useInViewport lives in hooks/home/useInViewport so both StateBoard and
// ShowcaseBoard reuse identical lazy-mount behavior (and so this component
// file does not export a non-component — react-refresh).

// ── PanelSlot — wraps one panel with error isolation + optional lazy-mount

interface PanelSlotProps {
    /** Mount immediately (above the fold). Omit for lazy-mount. */
    eager?: boolean
    label?: string
    children: React.ReactNode
}

function PanelSlot({ eager = false, label, children }: PanelSlotProps) {
    const { ref, inView } = useInViewport()
    const shouldMount = eager || inView

    return (
        <div ref={eager ? undefined : ref} className="state-board__slot">
            <PanelBoundary label={label}>
                {shouldMount ? children : null}
            </PanelBoundary>
        </div>
    )
}

// ── StateBoard ───────────────────────────────────────────────────────────

export interface StateBoardProps {
    /**
     * Panel elements. Each child is automatically wrapped in a PanelBoundary
     * and a lazy-mount container. Use the `eager` prop on a child slot to opt
     * out of lazy-mount for above-the-fold panels.
     *
     * Example:
     *   <StateBoard>
     *     <NetworkPulsePanel />          {/* lazy-mounted  *\/}
     *   </StateBoard>
     *
     *   — or wrap manually for eager: —
     *   <StateBoard eager={[0]}>
     *     <NetworkPulsePanel />          {/* first child = eager *\/}
     *   </StateBoard>
     */
    children: React.ReactNode
    /**
     * Indices of children that should mount eagerly (above the fold).
     * Defaults to [0] — the first panel is always eager.
     */
    eagerIndices?: number[]
}

/**
 * StateBoard — generic grid host for home status panels.
 * Does NOT know about specific panels. Tasks 1.5-1.10 plug panels in here.
 *
 * Keying: each PanelSlot is keyed by the child element's own React key
 * (set via `<Panel key="..." />` at the call-site), not by array index.
 * This prevents error/mount state from migrating to the wrong slot when
 * panels are conditional or reordered (Tasks 1.5-1.10).
 */
export function StateBoard({ children, eagerIndices = [0] }: StateBoardProps) {
    // React.Children.toArray assigns stable internal keys to each child.
    // element.key carries the caller-supplied key (e.g. "pulse" from
    // `<NetworkPulsePanel key="pulse" />`), prefixed with the parent's key
    // context (e.g. ".$pulse"). We use it verbatim — it is unique and stable.
    const childArray = React.Children.toArray(children)

    return (
        <div className="state-board" data-testid="state-board">
            {childArray.map((child, i) => {
                const element = child as React.ReactElement
                const slotKey = element.key ?? i
                return (
                    <PanelSlot key={slotKey} eager={eagerIndices.includes(i)}>
                        {child}
                    </PanelSlot>
                )
            })}
        </div>
    )
}

import { cloneElement, useState, type ReactElement, type ReactNode, type SyntheticEvent } from "react"
import { createPortal } from "react-dom"

/**
 * ValidatorHoverCard — a lightweight hover/focus preview popover.
 *
 * The preview is portaled to <body> so it isn't clipped by the validators table's
 * horizontal scroll container, and positioned just under the trigger (clamped to the
 * viewport). The trigger keeps its own click behaviour (rows/cards still navigate to the
 * profile). Shows on hover AND keyboard focus for accessibility.
 *
 * Usage: wrap any focusable trigger element (a <tr> or a card <div>):
 *   <ValidatorHoverCard content={<Preview .../>}><tr …>…</tr></ValidatorHoverCard>
 */
const CARD_WIDTH = 250

export function ValidatorHoverCard({
    content,
    children,
}: {
    content: ReactNode
    children: ReactElement
}) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

    const show = (e: SyntheticEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        // Viewport dimensions for clamping the popover (positioning, not breakpoints).
        const vw = document.documentElement.clientWidth
        const vh = document.documentElement.clientHeight
        const left = Math.max(8, Math.min(r.left, vw - CARD_WIDTH - 8))
        // Prefer below; flip above if there isn't room.
        const below = r.bottom + 6
        const top = below + 140 > vh ? Math.max(8, r.top - 6 - 140) : below
        setPos({ top, left })
    }
    const hide = () => setPos(null)

    const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
    })

    return (
        <>
            {trigger}
            {pos && createPortal(
                <div
                    className="vhc"
                    role="tooltip"
                    data-testid="validator-hovercard"
                    style={{ position: "fixed", top: pos.top, left: pos.left, width: CARD_WIDTH, zIndex: 2000 }}
                >
                    {content}
                </div>,
                document.body,
            )}
        </>
    )
}

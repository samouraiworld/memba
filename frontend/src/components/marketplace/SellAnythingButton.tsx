/**
 * SellAnythingButton — the single "Sell anything" entry (marketplace-v2 Phase 4.2).
 *
 * One CTA in the shell that routes to the right create/list flow by asset type. With a
 * single live lane it's a direct link; with several it opens an accessible disclosure
 * menu (Escape / outside-click close, focus return). Options come from `buildSellOptions`
 * (live lanes only — no "coming soon" rows).
 *
 * @module components/marketplace/SellAnythingButton
 */
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import type { SellOption } from "../../lib/marketplace/sellOptions"
import "./SellAnythingButton.css"

export interface SellAnythingButtonProps {
    options: SellOption[]
    label?: string
}

export function SellAnythingButton({ options, label = "Sell" }: SellAnythingButtonProps) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false)
                btnRef.current?.focus()
            }
        }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    if (options.length === 0) return null

    // Single live lane → a plain link (no menu needed).
    if (options.length === 1) {
        return (
            <Link to={options[0].to} className="k-btn-primary sell-btn">
                {label}
            </Link>
        )
    }

    return (
        <div className="sell-anything" ref={rootRef}>
            <button
                ref={btnRef}
                type="button"
                className="k-btn-primary sell-btn"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                {label}
            </button>
            {open && (
                <div className="sell-anything__menu" role="menu">
                    {options.map((o) => (
                        <Link
                            key={o.key}
                            to={o.to}
                            role="menuitem"
                            className="sell-anything__item"
                            onClick={() => setOpen(false)}
                        >
                            {o.label}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}

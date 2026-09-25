/**
 * The memba.club boot overlay (A → C, see boot.ts): the self-test types out on a
 * dark screen, collapses into a bright line, and the line opens into the page
 * underneath like a warming CRT. A click or any key skips it; it removes itself
 * after BOOT_MS. Decorative only (aria-hidden): screen readers get the lock screen.
 *
 * @module os/boot/BootScreen
 */
import { useCallback, useEffect, useRef, type CSSProperties } from "react"
import { BOOT_MS, type BootLine } from "./boot"
import "./boot.css"

/** Keys that never skip (moving focus or holding a modifier). */
const PASS_KEYS = new Set(["Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"])

function lineText(l: BootLine, width: number): string {
    return `${l.label} ${".".repeat(Math.max(2, width - l.label.length))} ${l.value}${l.status ? ` ${l.status}` : ""}`
}

export function BootScreen({ lines, onDone }: { lines: BootLine[]; onDone: () => void }) {
    const done = useRef(false)
    const finish = useCallback(() => {
        if (done.current) return
        done.current = true
        onDone()
    }, [onDone])

    useEffect(() => {
        const t = setTimeout(finish, BOOT_MS)
        // Captured and swallowed: a key that skips the boot must not also press the
        // lock screen's focused button underneath.
        const onKey = (e: KeyboardEvent) => {
            if (PASS_KEYS.has(e.key)) return
            e.preventDefault()
            e.stopPropagation()
            finish()
        }
        window.addEventListener("keydown", onKey, true)
        return () => {
            clearTimeout(t)
            window.removeEventListener("keydown", onKey, true)
        }
    }, [finish])

    const [head, ...rest] = lines
    const width = Math.max(...rest.map((l) => l.label.length)) + 6
    const line = (i: number, n: number): CSSProperties => ({ "--i": i, "--n": n } as CSSProperties)
    return (
        <div className="os-boot" data-testid="os-boot" aria-hidden="true" onClick={finish}>
            <div className="os-boot-glow" />
            <div className="os-boot-scan" />
            <div className="os-boot-half os-boot-top" />
            <div className="os-boot-half os-boot-bot" />
            <div className="os-boot-beam" />
            <div className="os-boot-a">
                <div className="os-boot-post">
                    {head && (
                        <div className="os-boot-ln" style={line(0, head.label.length + head.value.length + 3)}>
                            <b>{head.label}</b> <span className="os-boot-dim">·</span> {head.value}
                        </div>
                    )}
                    {rest.map((l, i) => {
                        const text = lineText(l, width)
                        const cut = text.length - (l.status ? l.status.length + 1 : 0)
                        return (
                            <div key={l.label} className="os-boot-ln" style={line(i + 1, text.length)}>
                                {text.slice(0, cut)}{l.status && <> <em>{l.status}</em></>}
                            </div>
                        )
                    })}
                    <div className="os-boot-ln" style={line(lines.length, 8)}>
                        <span className="os-boot-dim">&gt;</span> ready<span className="os-boot-cur" />
                    </div>
                </div>
            </div>
        </div>
    )
}

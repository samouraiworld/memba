import { useLayoutEffect, useState, type CSSProperties } from "react"
import { roomUrl } from "./rooms"
import "./meet.css"

type Rect = { left: number; top: number; width: number; height: number }

/** Keep the same iframe mounted while its window is moved, hidden or minimised. */
export function MeetStage({ roomId, slot, minimized, foreground, restore }: {
    roomId: string
    slot: HTMLDivElement | null
    minimized: boolean
    foreground: boolean
    restore: () => void
}) {
    const [rect, setRect] = useState<Rect | null>(null)
    useLayoutEffect(() => {
        if (!slot) return
        const measure = () => {
            const box = slot.getBoundingClientRect()
            const next = { left: box.left, top: box.top, width: box.width, height: box.height }
            setRect((prev) => prev && Object.keys(next).every((key) => prev[key as keyof Rect] === next[key as keyof Rect]) ? prev : next)
        }
        const firstFrame = requestAnimationFrame(measure)
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
        observer?.observe(slot)
        window.addEventListener("resize", measure)
        window.addEventListener("scroll", measure, true)
        window.addEventListener("pointermove", measure)
        return () => {
            cancelAnimationFrame(firstFrame)
            observer?.disconnect()
            window.removeEventListener("resize", measure)
            window.removeEventListener("scroll", measure, true)
            window.removeEventListener("pointermove", measure)
        }
    }, [slot])

    const pip = minimized
    const currentRect = slot ? rect : null
    const visible = pip || (foreground && currentRect !== null && currentRect.width > 0 && currentRect.height > 0)
    const style: CSSProperties = pip ? {} : currentRect ? { left: currentRect.left, top: currentRect.top, width: currentRect.width, height: currentRect.height } : {}

    return (
        <div className={`meet-stage${pip ? " meet-stage-pip" : ""}`} style={{ ...style, visibility: visible ? "visible" : "hidden" }} aria-hidden={!visible}>
            {pip && <div className="meet-pip-bar"><span>Meet · {roomId}</span><button type="button" onClick={restore}>Restore</button><a href={roomUrl(roomId)} target="_blank" rel="noopener noreferrer">Open ↗</a></div>}
            <iframe title={`Visio meeting ${roomId}`} src={roomUrl(roomId)}
                allow="camera; microphone; display-capture; autoplay; clipboard-write"
                allowFullScreen referrerPolicy="no-referrer" />
        </div>
    )
}

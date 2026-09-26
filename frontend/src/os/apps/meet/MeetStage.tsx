import { useLayoutEffect, useState, type CSSProperties } from "react"
import { roomUrl } from "./rooms"
import "./meet.css"

type Rect = { left: number; top: number; width: number; height: number; clipTop: number; clipRight: number; clipBottom: number; clipLeft: number }

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
            // The phone sheet scrolls under its title and floating dock. Clip the
            // fixed iframe to the scrollable area without moving/remounting it.
            const scroller = slot.closest(".os-ph-sheet-b")
            const bounds = scroller?.getBoundingClientRect()
            const dock = scroller?.closest(".os-phone")?.querySelector(".os-ph-dock")?.getBoundingClientRect()
            const top = bounds?.top ?? box.top
            const right = bounds?.right ?? box.right
            const bottom = Math.min(bounds?.bottom ?? box.bottom, dock ? dock.top - 8 : Infinity)
            const left = bounds?.left ?? box.left
            const next = {
                left: box.left, top: box.top, width: box.width, height: box.height,
                clipTop: Math.max(0, top - box.top), clipRight: Math.max(0, box.right - right),
                clipBottom: Math.max(0, box.bottom - bottom), clipLeft: Math.max(0, left - box.left),
            }
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
    const visible = pip || (foreground && currentRect !== null &&
        currentRect.width > currentRect.clipLeft + currentRect.clipRight &&
        currentRect.height > currentRect.clipTop + currentRect.clipBottom)
    const style: CSSProperties = pip ? {} : currentRect ? {
        left: currentRect.left, top: currentRect.top, width: currentRect.width, height: currentRect.height,
        clipPath: `inset(${currentRect.clipTop}px ${currentRect.clipRight}px ${currentRect.clipBottom}px ${currentRect.clipLeft}px)`,
    } : {}

    return (
        <div className={`meet-stage${pip ? " meet-stage-pip" : ""}`} style={{ ...style, visibility: visible ? "visible" : "hidden" }} aria-hidden={!visible}>
            {pip && <div className="meet-pip-bar"><span>Meet · {roomId}</span><button type="button" onClick={restore}>Restore</button><a href={roomUrl(roomId)} target="_blank" rel="noopener noreferrer">Open ↗</a></div>}
            <iframe title={`Visio meeting ${roomId}`} src={roomUrl(roomId)}
                allow="camera; microphone; display-capture; autoplay; clipboard-write"
                allowFullScreen referrerPolicy="no-referrer" />
        </div>
    )
}

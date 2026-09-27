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
        // Window and phone-sheet opening animations move the slot with a CSS
        // transform. ResizeObserver does not report transform movement, so
        // follow those animations until they settle instead of waiting for a
        // later pointer move to put the fixed iframe in the right place.
        const animatedWindow = slot.closest(".os-win, .os-ph-sheet")
        let followFrame = 0
        let following = false
        const follow = () => {
            measure()
            if (following) followFrame = requestAnimationFrame(follow)
        }
        const startFollowing = () => {
            if (following) return
            following = true
            followFrame = requestAnimationFrame(follow)
        }
        const stopFollowing = () => {
            following = false
            cancelAnimationFrame(followFrame)
            measure()
        }
        const settleTimer = window.setTimeout(stopFollowing, 350)
        const onAnimationStart = (event: Event) => {
            if (event.target !== animatedWindow) return
            clearTimeout(settleTimer)
            startFollowing()
        }
        const onAnimationEnd = (event: Event) => {
            if (event.target === animatedWindow) stopFollowing()
        }
        animatedWindow?.addEventListener("animationstart", onAnimationStart)
        animatedWindow?.addEventListener("animationend", onAnimationEnd)
        animatedWindow?.addEventListener("animationcancel", onAnimationEnd)
        startFollowing()
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
        observer?.observe(slot)
        window.addEventListener("resize", measure)
        window.addEventListener("scroll", measure, true)
        window.addEventListener("pointermove", measure)
        return () => {
            clearTimeout(settleTimer)
            following = false
            cancelAnimationFrame(followFrame)
            animatedWindow?.removeEventListener("animationstart", onAnimationStart)
            animatedWindow?.removeEventListener("animationend", onAnimationEnd)
            animatedWindow?.removeEventListener("animationcancel", onAnimationEnd)
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

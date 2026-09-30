import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react"
import { roomUrl } from "./rooms"
import "./meet.css"

type Rect = { left: number; top: number; width: number; height: number; clipTop: number; clipRight: number; clipBottom: number; clipLeft: number }

/** The room counts as shown only when at least this much of its slot is in view; below it the player shows. */
const MIN_SHOWN_WIDTH = 120
const MIN_SHOWN_HEIGHT = 90

/**
 * Keep the same iframe mounted while its window is moved, covered or minimised.
 * The meeting is connected for as long as the iframe exists, camera and
 * microphone included, so it is never hidden: whenever it has no visible place
 * in its window it shows as a small player above the windows and dialogs.
 * Closing the room window, and locking Memba (which closes every window),
 * remove the iframe and so end the call.
 */
type PrefixedDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }

/** A Memba OS dialog on screen: the shell's own (Connect, the launcher, the signing sheet sit on a scrim) or a native modal one (Settings). */
const DIALOG = ".os-scrim, dialog[open]"

/** Whether a dialog is open in this Memba OS, followed as dialogs open and close. */
function useDialogOpen(stage: RefObject<HTMLElement | null>): boolean {
    const [open, setOpen] = useState(false)
    useLayoutEffect(() => {
        const root = stage.current?.closest(".memba-os")
        if (!root) return
        const check = () => setOpen(root.querySelector(DIALOG) !== null)
        check()
        const observer = new MutationObserver(check)
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] })
        return () => observer.disconnect()
    }, [stage])
    return open
}

export function MeetStage({ roomId, slot, placed, minimized, foreground, restore, leave, toast }: {
    roomId: string
    slot: HTMLDivElement | null
    /** Changes whenever the room window is moved or resized, by any means (the keyboard moves it without a pointer event). */
    placed: string
    minimized: boolean
    /** The room window is in front and Memba is not locked or connecting (any open dialog is seen here). */
    foreground: boolean
    restore: () => void
    /** Closes the room window, which removes the iframe and so ends the call. */
    leave: () => void
    toast: (msg: string) => void
}) {
    const [rect, setRect] = useState<Rect | null>(null)
    const remeasure = useRef<(() => void) | null>(null)
    const frame = useRef<HTMLIFrameElement>(null)
    const stage = useRef<HTMLDivElement>(null)
    // Under any dialog the room is the small player, even with its window in front: the call never sits
    // full size behind a dialog, outside its Tab cycle.
    const covered = useDialogOpen(stage)
    const said = useRef(toast)
    useEffect(() => { said.current = toast })
    useEffect(() => {
        // Any other element in full screen covers the meeting, which is still live: full screen is
        // left so it shows, and the member is told why. Safari before 16.4 has only the prefixed API.
        const doc = document as PrefixedDocument
        let leaving = false
        const uncover = () => {
            const holder = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
            if (!holder || holder === frame.current) { leaving = false; return }
            if (leaving) return
            leaving = true
            said.current("Another window can't take full screen while a meeting is live here.")
            if (document.exitFullscreen) void document.exitFullscreen().catch(() => {})
            else doc.webkitExitFullscreen?.()
        }
        uncover()
        document.addEventListener("fullscreenchange", uncover)
        document.addEventListener("webkitfullscreenchange", uncover)
        return () => {
            document.removeEventListener("fullscreenchange", uncover)
            document.removeEventListener("webkitfullscreenchange", uncover)
        }
    }, [])
    useLayoutEffect(() => {
        if (!slot) return
        const measure = () => {
            const box = slot.getBoundingClientRect()
            // The phone sheet scrolls under its title and floating dock. Clip the
            // fixed iframe to the scrollable area without moving/remounting it.
            const scroller = slot.closest(".os-ph-sheet-b")
            const bounds = scroller?.getBoundingClientRect()
            const dock = scroller?.closest(".os-phone")?.querySelector(".os-ph-dock")?.getBoundingClientRect()
            // A window can be dragged partly or wholly off the desk: what is outside Memba OS is not visible either.
            const desk = slot.closest(".memba-os")?.getBoundingClientRect()
            const top = Math.max(bounds?.top ?? box.top, desk?.top ?? -Infinity)
            const right = Math.min(bounds?.right ?? box.right, desk?.right ?? Infinity)
            const bottom = Math.min(bounds?.bottom ?? box.bottom, dock ? dock.top - 8 : Infinity, desk?.bottom ?? Infinity)
            const left = Math.max(bounds?.left ?? box.left, desk?.left ?? -Infinity)
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
        remeasure.current = measure
        return () => {
            remeasure.current = null
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

    // The slot arrives after the stage (through the window), and a window moved with the keyboard fires no event.
    useLayoutEffect(() => { remeasure.current?.() }, [placed, slot])

    const currentRect = slot ? rect : null
    const inSlot = foreground && !covered && !minimized && currentRect !== null &&
        currentRect.width - currentRect.clipLeft - currentRect.clipRight >= MIN_SHOWN_WIDTH &&
        currentRect.height - currentRect.clipTop - currentRect.clipBottom >= MIN_SHOWN_HEIGHT
    // Hidden only between a slot appearing and its first measurement (one frame).
    // With no slot at all (the phone's Notifications sheet replaces the room's) the player shows.
    const measuring = foreground && !covered && !minimized && slot !== null && currentRect === null
    const pip = !inSlot && !measuring
    // Leave removes this bar: focus goes back into the dialog it was pressed over, never to the page.
    const leaveToDialog = () => {
        const dialog = stage.current?.closest(".memba-os")?.querySelector<HTMLElement>('[aria-modal="true"], dialog[open]')
        leave()
        if (!dialog) return
        const target = dialog.tabIndex >= 0 || dialog.hasAttribute("tabindex") ? dialog : dialog.querySelector<HTMLElement>("input, button, [tabindex]") ?? dialog
        target.focus({ preventScroll: true })
    }
    const style: CSSProperties = inSlot ? {
        left: currentRect.left, top: currentRect.top, width: currentRect.width, height: currentRect.height,
        clipPath: `inset(${currentRect.clipTop}px ${currentRect.clipRight}px ${currentRect.clipBottom}px ${currentRect.clipLeft}px)`,
    } : {}

    return (
        <div ref={stage} className={`meet-stage${pip ? " meet-stage-pip" : ""}`} style={{ ...style, visibility: measuring ? "hidden" : "visible" }} aria-hidden={measuring}
            role={pip ? "region" : undefined} aria-label={pip ? `Meeting ${roomId} is still open` : undefined}>
            {pip && (
                <div className="meet-pip-bar">
                    <span>Meet · {roomId}</span>
                    <button type="button" className="meet-pip-window" onClick={restore}>Restore</button>
                    {/* Reachable above the shell's dialogs, which add [data-os-over-dialog] controls to their Tab cycle (useDialogKeys).
                        Settings' reset dialog is a native modal one: nothing outside it takes a press until it closes. */}
                    <button type="button" data-os-over-dialog="" onClick={leaveToDialog}>Leave</button>
                    <a className="meet-pip-window" href={roomUrl(roomId)} target="_blank" rel="noopener noreferrer">Open ↗</a>
                </div>
            )}
            <iframe ref={frame} title={`Visio meeting ${roomId}`} src={roomUrl(roomId)}
                allow="camera; microphone; display-capture; autoplay; clipboard-write"
                allowFullScreen referrerPolicy="no-referrer" />
        </div>
    )
}

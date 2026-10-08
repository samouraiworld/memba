import { useEffect, useState } from "react"
import { useWindowActive } from "../os/page/WindowActivity"

/** Relative ages advance only while the page and its OS window are visible. */
export function useMinuteClock(): number {
    const active = useWindowActive()
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        if (!active) return
        let timer: ReturnType<typeof setInterval> | null = null
        const tick = () => setNowMs(Date.now())
        const visibilityChanged = () => {
            if (document.hidden) {
                if (timer) clearInterval(timer)
                timer = null
            } else {
                tick()
                if (!timer) timer = setInterval(tick, 60_000)
            }
        }
        visibilityChanged()
        document.addEventListener("visibilitychange", visibilityChanged)
        return () => {
            if (timer) clearInterval(timer)
            document.removeEventListener("visibilitychange", visibilityChanged)
        }
    }, [active])
    return nowMs
}

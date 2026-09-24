import { useEffect, useState } from "react"

function now(): [string, string] {
    const d = new Date()
    return [
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
    ]
}

/** The time and date, refreshed every 15 s. */
export function useClock(): [string, string] {
    const [t, setT] = useState(now)
    useEffect(() => {
        const id = setInterval(() => setT(now()), 15_000)
        return () => clearInterval(id)
    }, [])
    return t
}

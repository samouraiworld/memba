/**
 * False once the component is gone: work that returns late (a fee quote) must
 * not open a sheet or set state for a window that was closed meanwhile.
 *
 * @module os/shell/useAlive
 */
import { useEffect, useRef } from "react"

export function useAlive() {
    const alive = useRef(true)
    useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
    }, [])
    return alive
}

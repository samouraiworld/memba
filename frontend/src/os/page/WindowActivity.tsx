import { createContext, useContext } from "react"

/** Classic pages are active by default outside Memba OS. */
export const WindowActivityContext = createContext(true)

export function useWindowActive(): boolean {
    return useContext(WindowActivityContext)
}

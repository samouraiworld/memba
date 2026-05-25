import { useEffect } from "react"
import { useLocation } from "react-router-dom"

export function useFocusOnRouteChange(): void {
    const { pathname } = useLocation()
    useEffect(() => {
        const h1 = document.querySelector<HTMLElement>("h1")
        if (h1) {
            if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1")
            h1.focus({ preventScroll: true })
        }
    }, [pathname])
}

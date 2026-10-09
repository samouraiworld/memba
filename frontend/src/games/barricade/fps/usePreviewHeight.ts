import { useEffect, useRef, type RefObject } from 'react'

/** Measure only our available area; never resize or style the shared OS window. */
export function usePreviewHeight(): RefObject<HTMLElement | null> {
    const root = useRef<HTMLElement>(null)
    useEffect(() => {
        const node = root.current
        if (!node) return
        const windowBody = node.closest<HTMLElement>('.os-wbody')
        const resize = () => {
            const rect = node.getBoundingClientRect()
            const viewport = window.visualViewport
            const bottom = viewport ? viewport.offsetTop + viewport.height : document.documentElement.clientHeight
            if (!bottom || !rect.width) return
            const windowBottom = windowBody?.getBoundingClientRect().bottom ?? bottom
            const height = Math.floor(Math.min(bottom, windowBottom) - Math.max(0, rect.top) - 8)
            node.style.setProperty('--fps-available-height', `${Math.max(160, height)}px`)
            node.dataset.compact = String(height < 500 && rect.width >= 500)
        }
        resize()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
        observer?.observe(node)
        if (windowBody) observer?.observe(windowBody)
        window.addEventListener('resize', resize)
        window.visualViewport?.addEventListener('resize', resize)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', resize)
            window.visualViewport?.removeEventListener('resize', resize)
        }
    }, [])
    return root
}

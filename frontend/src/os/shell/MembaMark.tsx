import { useId } from "react"

/** One folded silhouette, with quiet menu and faceted intro treatments. */
export function MembaMark({ className = "os-mark", faceted = false }: { className?: string; faceted?: boolean }) {
    const id = useId()
    return (
        <svg className={className} viewBox="-8 -10 128 124" aria-hidden="true" focusable="false" data-faceted={faceted || undefined}>
            {faceted ? <>
                <defs>
                    <linearGradient id={`${id}-left`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d9d1ff" /><stop offset="1" stopColor="#aaa4d2" /></linearGradient>
                    <linearGradient id={`${id}-right`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#d8d2f2" /><stop offset="1" stopColor="#f7f6ff" /></linearGradient>
                </defs>
                <path d="M0 29.6 25 52V102H0Z M87 52 112 0V102H87Z" fill="#fff" />
                <path d="M0 0 56 46.6V80.8L0 29.6Z" fill={`url(#${id}-left)`} />
                <path d="M56 46.6 112 0 87 52 56 80.8Z" fill={`url(#${id}-right)`} />
            </> : <path d="M0 0 56 46.6 112 0V102H87V52L56 80.8 25 52V102H0Z" />}
        </svg>
    )
}

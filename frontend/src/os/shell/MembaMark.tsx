/** The folded-M from /brand/folded-m/favicon.svg, inline so it follows the OS theme rather than the system one. */
export function MembaMark({ className = "os-mark" }: { className?: string }) {
    return (
        <svg className={className} viewBox="-8 -14 128 128" aria-hidden="true" focusable="false">
            <path d="M0 0 56 45 112 0V100H87V50L56 79 25 50V100H0Z" />
        </svg>
    )
}

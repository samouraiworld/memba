interface SkeletonProps {
    width?: string | number
    height?: string | number
    borderRadius?: number
    className?: string
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 6, className }: SkeletonProps) {
    return (
        <div
            className={className}
            style={{
                width,
                height,
                borderRadius,
                background: "linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)",
                backgroundSize: "200% 100%",
                animation: "skeleton-shimmer 1.5s ease-in-out infinite",
            }}
        />
    )
}

/** Card-shaped loading skeleton */
export function SkeletonCard() {
    return (
        <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton width={80} height={10} />
            <Skeleton width="60%" height={24} />
        </div>
    )
}

/** Table row loading skeleton */
export function SkeletonRow() {
    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr auto",
            gap: 12,
            padding: "14px 20px",
            borderBottom: "1px solid #1a1a1a",
        }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="50%" height={14} />
            <Skeleton width={80} height={22} borderRadius={6} />
            <Skeleton width={60} height={14} />
        </div>
    )
}

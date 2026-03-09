/**
 * GlowBorder — Animated border glow effect using Remotion's spring().
 *
 * Wraps children in a container with a pulsing accent-colored glow,
 * matching the existing `glow` keyframe from index.css.
 */
import { useCurrentFrame, interpolate } from "remotion"
import type { CSSProperties, ReactNode } from "react"

interface GlowBorderProps {
    children: ReactNode
    /** Frame at which the glow starts pulsing. */
    startFrame?: number
    color?: string
    style?: CSSProperties
}

export function GlowBorder({ children, startFrame = 0, color = "#00d4aa", style }: GlowBorderProps) {
    const frame = useCurrentFrame()
    const elapsed = Math.max(0, frame - startFrame)

    // Pulsing glow: sin wave with 2.5s period (≈75 frames at 30fps)
    const glowIntensity = interpolate(
        Math.sin(elapsed * 0.08),
        [-1, 1],
        [0, 0.25],
    )

    return (
        <div
            style={{
                borderRadius: 8,
                border: `1px solid ${color}33`,
                boxShadow: `0 0 ${12 + glowIntensity * 20}px ${glowIntensity * 6}px ${color}${Math.round(glowIntensity * 255).toString(16).padStart(2, "0")}`,
                ...style,
            }}
        >
            {children}
        </div>
    )
}

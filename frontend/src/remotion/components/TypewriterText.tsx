/**
 * TypewriterText — Character-by-character reveal using Remotion's interpolate().
 *
 * Renders text as if it's being typed, one character at a time.
 */
import { useCurrentFrame, interpolate } from "remotion"

interface TypewriterProps {
    text: string
    /** Frame at which typing starts. */
    startFrame?: number
    /** Frames per character (lower = faster). */
    speed?: number
    style?: React.CSSProperties
}

export function TypewriterText({ text, startFrame = 0, speed = 2, style }: TypewriterProps) {
    const frame = useCurrentFrame()
    const elapsed = Math.max(0, frame - startFrame)

    const charsVisible = Math.min(
        text.length,
        Math.floor(
            interpolate(elapsed, [0, text.length * speed], [0, text.length], {
                extrapolateRight: "clamp",
            })
        )
    )

    const visible = text.slice(0, charsVisible)
    const showCursor = elapsed < text.length * speed + 15

    return (
        <span style={style}>
            {visible}
            {showCursor && (
                <span style={{ opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0, color: "var(--color-primary)" }}>▏</span>
            )}
        </span>
    )
}

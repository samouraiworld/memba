/**
 * StarRating — display + input mode for 0–5 star ratings.
 *
 * Display mode (no onChange): renders filled/empty stars for a numeric value.
 * Input mode (with onChange):  an accessible radiogroup —
 *   - roving tabindex (only the selected, or first, star is tabbable)
 *   - Left/Down ↓ decrement, Right/Up ↑ increment, Home/End jump to 1/5
 *   - hover-fill preview (stars 1..n fill while hovering star n)
 */

import { useState } from "react"

interface StarRatingProps {
  value: number
  onChange?: (rating: number) => void
  size?: "sm" | "md"
  /** id of an external label element, associated via aria-labelledby (input mode). */
  ariaLabelledBy?: string
}

export function StarRating({ value, onChange, size = "md", ariaLabelledBy }: StarRatingProps) {
  const isInput = !!onChange
  const [hover, setHover] = useState(0)

  const className = `star-rating${isInput ? "" : " star-rating--display"}${size === "sm" ? " star-rating--sm" : ""}`

  if (!isInput) {
    return (
      <span className={className} role="img" aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="star-rating__icon"
            aria-hidden="true"
            style={{ color: n <= value ? "var(--color-k-accent-text)" : "var(--color-k-muted)" }}
          >
            {n <= value ? "★" : "☆"}
          </span>
        ))}
      </span>
    )
  }

  // Input mode: radiogroup with roving tabindex + keyboard.
  // From an empty selection (value=0): ArrowRight → 1, ArrowLeft → 1 (clamped).
  const handleKey = (e: React.KeyboardEvent) => {
    let next = 0
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, value + 1)
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, value - 1 || 1)
    else if (e.key === "Home") next = 1
    else if (e.key === "End") next = 5
    else return
    e.preventDefault()
    onChange!(next)
  }

  // Which star is "tabbable" (roving): the selected one, or star 1 when nothing selected.
  const tabbable = value || 1
  const shown = hover || value

  return (
    <span
      className={className}
      role="radiogroup"
      aria-label={ariaLabelledBy ? undefined : "Rating"}
      aria-labelledby={ariaLabelledBy}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n !== 1 ? "s" : ""}`}
            tabIndex={n === tabbable ? 0 : -1}
            className="star-rating__btn"
            onClick={() => onChange!(n)}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onKeyDown={handleKey}
            style={{ color: filled ? "var(--color-k-accent-text)" : "var(--color-k-muted)" }}
          >
            <span className="star-rating__icon" aria-hidden="true">{filled ? "★" : "☆"}</span>
          </button>
        )
      })}
    </span>
  )
}

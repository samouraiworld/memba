/**
 * StarRating — display + input mode for 0–5 star ratings.
 *
 * Display mode (no onChange): renders filled/empty stars for a numeric value.
 * Input mode (with onChange):  clickable, keyboard-accessible buttons (1–5).
 */

interface StarRatingProps {
  value: number
  onChange?: (rating: number) => void
  size?: "sm" | "md"
}

export function StarRating({ value, onChange, size = "md" }: StarRatingProps) {
  const isInput = !!onChange

  const stars = [1, 2, 3, 4, 5].map((n) => {
    const filled = n <= value
    const icon = filled ? "★" : "☆"
    const label = `${n} star${n !== 1 ? "s" : ""}`

    if (isInput) {
      return (
        <button
          key={n}
          type="button"
          className="star-rating__btn"
          aria-label={label}
          onClick={() => onChange!(n)}
          style={{ color: filled ? "var(--color-k-accent-text)" : "var(--color-k-muted)" }}
        >
          <span className="star-rating__icon" aria-hidden="true">{icon}</span>
        </button>
      )
    }

    return (
      <span
        key={n}
        className="star-rating__icon"
        aria-hidden="true"
        style={{ color: filled ? "var(--color-k-accent-text)" : "var(--color-k-muted)" }}
      >
        {icon}
      </span>
    )
  })

  return (
    <span
      className={`star-rating${isInput ? "" : " star-rating--display"}${size === "sm" ? " star-rating--sm" : ""}`}
      role={isInput ? "group" : undefined}
      aria-label={isInput ? "Rating" : `${value} out of 5 stars`}
    >
      {stars}
    </span>
  )
}

/**
 * HackerModeToggle — header toggle for switching between Standard and Hacker mode
 * on the /validators page.
 *
 * Persists preference to localStorage under 'memba_hacker_mode'.
 */

import "./hacker-mode.css"

interface HackerModeToggleProps {
    isHackerMode: boolean
    onChange: (enabled: boolean) => void
}

export function HackerModeToggle({ isHackerMode, onChange }: HackerModeToggleProps) {
    return (
        <button
            id="hacker-mode-toggle"
            className={`hacker-toggle ${isHackerMode ? "hacker-toggle--active" : ""}`}
            onClick={() => onChange(!isHackerMode)}
            aria-pressed={isHackerMode}
            title={isHackerMode ? "Switch to Standard view" : "Switch to Hacker Mode"}
        >
            <span className="hacker-toggle__icon" aria-hidden="true">
                {isHackerMode ? "⬡" : "⬢"}
            </span>
            <span className="hacker-toggle__label">
                {isHackerMode ? "HACKER" : "Standard"}
            </span>
            <span className="hacker-toggle__dot" />
        </button>
    )
}

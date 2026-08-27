/**
 * useTabListKeyboard — the ARIA Authoring Practices tabs keyboard contract,
 * in one place.
 *
 * WHY. The app has fifteen `role="tablist"` surfaces. Three implemented the APG
 * keyboard pattern by hand (Directory, UnifiedMarketplace, ValidatorProfile),
 * two partially, and **nine had no keyboard support at all**: a keyboard user
 * landing on those tabs could not move between them with the arrow keys, which
 * is the only way the pattern says to move between them. Tab itself skips the
 * whole list, because a correct tablist is a single tab stop.
 *
 * Hand-rolling it fifteen times is how five of them ended up different from each
 * other. This is the Directory implementation — the most complete of the three —
 * extracted verbatim in behaviour, so adopting it is a subtraction.
 *
 * WHAT THE PATTERN REQUIRES (w3.org/WAI/ARIA/apg/patterns/tabs):
 *   - the tablist is ONE tab stop: the selected tab has tabIndex 0, the rest -1
 *     (the "roving" tabindex);
 *   - Left/Right move between tabs and wrap around;
 *   - Home/End jump to the first/last;
 *   - moving selection moves focus with it, or the user is navigating something
 *     they cannot see.
 *
 * Deliberately NOT handled here: Enter/Space. These are `<button>` elements, so
 * the browser already fires click for both; intercepting them would duplicate
 * activation. Nor is the manual-activation variant of the pattern implemented —
 * every tablist in this app activates on focus, and offering both would be a
 * config nobody sets correctly.
 */
import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react"

export interface TabListKeyboardOptions<T extends string> {
    /** Tab keys in visual order. Order defines what "next" and "previous" mean. */
    keys: readonly T[]
    /** The currently selected key. */
    active: T
    /** Called with the key the user moved to. */
    onSelect: (key: T) => void
    /**
     * DOM id for a tab's button, so focus can follow selection. Must match the
     * `id` actually rendered — the returned `tabProps` supplies it, so use those
     * and the two cannot drift apart.
     */
    idFor?: (key: T) => string
}

export interface TabProps {
    id: string
    role: "tab"
    "aria-selected": boolean
    tabIndex: 0 | -1
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
}

export function useTabListKeyboard<T extends string>({
    keys,
    active,
    onSelect,
    idFor = (key) => `tab-${key}`,
}: TabListKeyboardOptions<T>): { tabProps: (key: T) => TabProps } {
    const handleKeyDown = useCallback(
        (e: ReactKeyboardEvent<HTMLElement>, key: T) => {
            const i = keys.indexOf(key)
            // A key that is not in the list would make every index arithmetic
            // below wrong; do nothing rather than jump somewhere arbitrary.
            if (i === -1 || keys.length === 0) return

            let next: T | null = null
            if (e.key === "ArrowRight") next = keys[(i + 1) % keys.length]
            else if (e.key === "ArrowLeft") next = keys[(i - 1 + keys.length) % keys.length]
            else if (e.key === "Home") next = keys[0]
            else if (e.key === "End") next = keys[keys.length - 1]
            if (next === null) return

            // Only once a key is actually handled: preventing default on
            // everything would swallow Tab and trap the user in the tablist.
            e.preventDefault()
            onSelect(next)

            // After the re-render selection triggers, not before — focusing
            // synchronously here would land on the pre-update DOM.
            //
            // setTimeout, not requestAnimationFrame, which the extracted
            // original used: rAF does not fire while a tab is hidden, so the
            // focus move silently never happened in a backgrounded tab. Measured
            // directly in a real browser — visibilityState "hidden", no rAF
            // callback within 600ms, while selection updated normally. Nothing
            // about moving focus needs aligning with paint.
            const id = idFor(next)
            setTimeout(() => document.getElementById(id)?.focus(), 0)
        },
        [keys, onSelect, idFor],
    )

    const tabProps = useCallback(
        (key: T): TabProps => ({
            id: idFor(key),
            role: "tab",
            "aria-selected": key === active,
            // The roving tabindex. Without it every tab is its own tab stop and
            // a ten-tab list costs ten presses to get past.
            tabIndex: key === active ? 0 : -1,
            onKeyDown: (e) => handleKeyDown(e, key),
        }),
        [active, handleKeyDown, idFor],
    )

    return { tabProps }
}

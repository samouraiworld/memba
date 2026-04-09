/**
 * Plausible Analytics — fire-and-forget custom events.
 *
 * Safe to call even if Plausible is blocked by an ad-blocker.
 * Uses optional chaining so the app works identically without it.
 */

export function trackEvent(name: string, props?: Record<string, string | number | boolean>): void {
    window.plausible?.(name, props ? { props } : undefined)
}

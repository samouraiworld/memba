// Thin, feature-detected wrapper over the Vibration API. iOS Safari has no
// vibrate() and silently ignores it — that's fine; this never throws.
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* haptics unsupported — ignore */
  }
}

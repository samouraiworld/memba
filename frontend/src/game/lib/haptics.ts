/**
 * Short vibration cues for phones. A progressive enhancement: silently does
 * nothing where the Vibration API is missing (iOS Safari, desktops), where it
 * throws, or when the player asked the system to reduce motion.
 */
export const HAPTIC_MERGE = 12;
export const HAPTIC_GAME_OVER: number[] = [40, 60, 90];

export function haptic(pattern: number | number[]): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

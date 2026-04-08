/**
 * Onboarding wizard state helpers.
 * Per-wallet localStorage flag prevents repeat showing.
 */

const WIZARD_KEY_PREFIX = "memba_wizard_seen_"

/** Check if the wizard has been seen for this wallet address. */
export function hasSeenWizard(address: string): boolean {
    try {
        return localStorage.getItem(WIZARD_KEY_PREFIX + address) === "1"
    } catch {
        return true // fail closed — don't show if storage unavailable
    }
}

/** Mark the wizard as seen for this wallet address. */
export function markWizardSeen(address: string): void {
    try {
        localStorage.setItem(WIZARD_KEY_PREFIX + address, "1")
    } catch { /* quota exceeded — non-blocking */ }
}

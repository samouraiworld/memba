/**
 * Build-time feature flags for the gnolove section.
 *
 * Reading flags through these helpers (rather than touching `import.meta.env`
 * scattered across the codebase) means the names live in exactly one place
 * and tests can stub them with `vi.stubEnv`.
 *
 * @module lib/gnoloveFeatureFlags
 */

function readBoolFlag(value: unknown): boolean {
    return value === true || value === "true" || value === "1"
}

/**
 * VITE_GNOLOVE_TEAM_HUB — gates the Phase 4 team hub rebuild.
 *
 * When false (default), `/gnolove/teams/:teamName` renders the legacy
 * GnoloveTeamProfileLegacy stub. When true, the new six-card team hub
 * ships. Also used as the auto-degrade fallback target.
 */
export function isTeamHubEnabled(): boolean {
    return readBoolFlag(import.meta.env.VITE_GNOLOVE_TEAM_HUB)
}

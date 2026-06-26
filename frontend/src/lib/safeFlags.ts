// Build-time fund-flag safety gate. Shared by vite.config.ts (enforcement) and
// its test. These flags gate features whose on-chain enforcement is incomplete —
// shipping one enabled could move funds unsafely.
//
// WHY build-time, not the old CI `.env.example` grep: the prod build reads the
// root `.env` AND Netlify dashboard env vars, which a `.env.example` grep never
// sees — so a flag enabled in the Netlify dashboard shipped green. This runs
// inside `npm run build` (CI AND the Netlify build), catching an enabled flag
// from ANY source.
//
// To enable a flag legitimately: remove it from SAFETY_GATED_FLAGS AND pass code
// review (the build fails otherwise).
export const SAFETY_GATED_FLAGS = [
    "VITE_ENABLE_NFT",
    "VITE_ENABLE_SERVICES",
    "VITE_ENABLE_TREASURY_SPEND",
    "VITE_ENABLE_AGENT_CREDITS",
] as const

/**
 * Throws (failing the build) if any safety-gated flag resolves to the exact
 * string "true" — the same value the app and the former CI gate treat as enabled.
 */
export function assertSafeFlags(env: Record<string, string | undefined>): void {
    const enabled = SAFETY_GATED_FLAGS.filter((flag) => env[flag] === "true")
    if (enabled.length > 0) {
        throw new Error(
            `SAFETY GATE FAILED — ${enabled.join(", ")}="true". ` +
                `These flags gate features with incomplete on-chain enforcement. ` +
                `To enable: remove from SAFETY_GATED_FLAGS in frontend/src/lib/safeFlags.ts AND pass code review.`,
        )
    }
}

/**
 * Whether the fund-flag gate should enforce for this build. Enforces on CI /
 * local production builds (no Netlify CONTEXT) and the Netlify PRODUCTION build
 * (CONTEXT=production) — the builds that ship to real users. Skips Netlify
 * deploy-previews and branch-deploys, where a team legitimately enables a gated
 * flag to test the feature. Never enforces in dev/serve.
 */
export function shouldEnforceFlagGate(command: string, context: string | undefined): boolean {
    return command === "build" && context !== "deploy-preview" && context !== "branch-deploy"
}

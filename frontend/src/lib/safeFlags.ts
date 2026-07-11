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
    // VITE_ENABLE_NFT removed 2026-06-27 — the NFT marketplace went live: the v3.1
    // engine + fee config are deployed, registered, and verified on test13 (fee→DAO
    // treasury enforced on-chain). The flag now legitimately turns the lane on in prod.
    "VITE_ENABLE_TREASURY_SPEND",
    "VITE_ENABLE_AGENT_CREDITS",
    // VITE_ENABLE_APPSTORE de-gated 2026-07-07 after memba_appstore_v2 deployed on
    // test13 with a self-managed 2-of-2 admin and a live-verified fee path. The flag
    // now legitimately turns the App Store lane on in prod.
    // VITE_ENABLE_APPSTORE_SUBMIT de-gated 2026-07-10: memba_appstore_v3 deployed,
    // seeded from v2 and SEALED (FinalizeSeed), and the §7 fee-path checklist passed
    // live on test13 from a plain wallet (exact-fee refund/accept, reject/resubmit
    // credit, flag dedupe, sealed-seed panic). The flag now legitimately opens
    // /apps/submit in prod.
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

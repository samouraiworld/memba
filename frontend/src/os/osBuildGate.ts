// Build-time guard for the Memba OS flag. Shared by vite.config.ts (enforcement)
// and its test, so it must stay free of browser-only APIs.
//
// WHY a separate gate instead of SAFETY_GATED_FLAGS: that list fails EVERY
// enforced build, and a standalone Netlify site's own deploys run with
// CONTEXT=production too — so it would also fail the memba.club beta site, the
// one place Memba OS is meant to run before launch. This gate fails enforced
// builds (CI, the production Netlify site) that turn VITE_MEMBA_OS on, unless
// the site also opts in with MEMBA_OS_BETA_SITE=true — set only in the beta
// site's dashboard. It isn't a VITE_ variable, so it never reaches the client.

export const OS_FLAG = "VITE_MEMBA_OS"
export const OS_BETA_SITE = "MEMBA_OS_BETA_SITE"

/** Throws (failing the build) if Memba OS is enabled outside the beta site. */
export function assertOsFlagAllowed(env: Record<string, string | undefined>): void {
    if (env[OS_FLAG] === "true" && env[OS_BETA_SITE] !== "true") {
        throw new Error(
            `MEMBA OS GATE FAILED — ${OS_FLAG}="true" on a build that isn't the Memba OS beta site. ` +
                `Memba OS ships only on the beta site until launch. To build it there, also set ${OS_BETA_SITE}="true" ` +
                `in that site's environment. Never set it on the production site.`,
        )
    }
}

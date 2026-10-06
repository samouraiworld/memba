/**
 * memba.samourai.app is being retired in favour of memba.club. These are the
 * hosts that serve the retired classic site: the domain and its Netlify canary.
 *
 * @module lib/retiredSite
 */
export const RETIRED_HOSTS: ReadonlySet<string> = new Set(["memba.samourai.app", "memba-multisig.netlify.app"])

export const NEW_ORIGIN = "https://memba.club"

/** Whether this page is served by the retired classic site. */
export function isRetiredHost(hostname: string = window.location.hostname): boolean {
    return RETIRED_HOSTS.has(hostname)
}

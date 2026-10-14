/** Independent release switches: local editing never enables a transaction. */
export const NOTES_ENABLED = import.meta.env.VITE_ENABLE_NOTES === "true"
export const NOTE_ID = /^[0-9a-f]{32}$/
export const MAX_NOTE_BODY_BYTES = 131_072

export interface NotesDeploymentEntry { realm: string; version: 1 }
/**
 * Publishing needs a reviewed deployment entry as well as its release switch. Each network names
 * its own realm path: every read, message, signing sheet and receipt uses the entry's path.
 */
const DEPLOYMENTS: Readonly<Record<string, NotesDeploymentEntry>> = Object.freeze({
    // Testnet canary: published 2026-10-11 at h330932 from samcrew-deployer c20e8e6c
    // (payload 84bcef70…, 23 files), read back byte-identical. No mainnet entry yet
    // (mainnet will be gno.land/r/samcrew/memba_notes_v1).
    "onyx-1": Object.freeze({ realm: "gno.land/r/samcrew/memba_notes_v1", version: 1 as const }),
})
export function notesDeployment(chainId: string): NotesDeploymentEntry | null {
    return NOTES_ENABLED && import.meta.env.VITE_ENABLE_NOTES_CHAIN === "true" ? deploymentRealmEntry(chainId) : null
}
/** The reviewed realm path of a network, whatever the release switches say: durable receipts are checked against it. */
export function deploymentRealm(chainId: string): string | null { return deploymentRealmEntry(chainId)?.realm ?? null }
function deploymentRealmEntry(chainId: string): NotesDeploymentEntry | null {
    return Object.hasOwn(DEPLOYMENTS, chainId) ? DEPLOYMENTS[chainId] ?? null : null
}

export function newNoteId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")
}

export function validNoteTitle(title: string): boolean {
    return title === title.trim() && title.length > 0 && [...title].length <= 80
        && new TextEncoder().encode(title).length <= 160
        && ![...title].some(char => { const code = char.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff })
        && !/[\p{Cc}\p{Cf}/]/u.test(title)
}

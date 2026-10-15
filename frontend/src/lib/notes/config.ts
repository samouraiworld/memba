/** Independent release switches: local editing never enables a transaction. */
export const NOTES_ENABLED = import.meta.env.VITE_ENABLE_NOTES === "true"
export const NOTE_ID = /^[0-9a-f]{32}$/
export const MAX_NOTE_BODY_BYTES = 131_072

export interface NotesDeploymentEntry { realm: string; version: 1 }
/**
 * Publishing needs a reviewed deployment entry as well as its release switch. Each network names
 * its own realm path: every read, message, signing sheet and receipt uses the entry's path.
 */
export const DEPLOYMENTS: Readonly<Record<string, NotesDeploymentEntry>> = Object.freeze({
    // Mainnet: published 2026-10-14 at h806211 from samcrew-deployer e485e2ab (key registry
    // gno.land/r/samcrew/enckeys_v1 at h806205), admin the samcrew 2-of-3. Its 23 files match
    // onyx-1's memba_notes_rc1 except the module path.
    "gnoland-1": Object.freeze({ realm: "gno.land/r/samcrew/memba_notes_v1", version: 1 as const }),
    // Testnet release candidate: published 2026-10-14 at h398276 from samcrew-deployer a5d6082
    // (rc1 path variant of the mainnet Notes source, payload cc8e7e5e…, 23 files), read back
    // byte-identical.
    "onyx-1": Object.freeze({ realm: "gno.land/r/samcrew/memba_notes_rc1", version: 1 as const }),
})
export function notesDeployment(chainId: string): NotesDeploymentEntry | null {
    return NOTES_ENABLED && import.meta.env.VITE_ENABLE_NOTES_CHAIN === "true" ? deploymentRealmEntry(chainId) : null
}
/**
 * Private (encrypted) notes. A compile-time switch: a build without it has no private code at all
 * (check-lazy-chunk.mjs notes-private). Both private switches stay in SAFETY_GATED_FLAGS.
 */
export const PRIVATE_NOTES_BUILD = import.meta.env.VITE_ENABLE_NOTES_ENCRYPTED === "true"
/** Networks where private notes may open; gnoland-1 joins only through its own release review. */
export const PRIVATE_CHAINS: readonly string[] = Object.freeze(["onyx-1"])
/** The deployment private notes use on this network, or null: every private read, key and signing path checks it. */
export function privateNotesDeployment(chainId: string): NotesDeploymentEntry | null {
    return PRIVATE_NOTES_BUILD && PRIVATE_CHAINS.includes(chainId) ? notesDeployment(chainId) : null
}
/** Vault mode, Reveal and publishing a private note publicly: a second switch on top of private notes. */
export function vaultRevealEnabled(chainId: string): boolean {
    return privateNotesDeployment(chainId) !== null && import.meta.env.VITE_ENABLE_NOTES_VAULT_REVEAL === "true"
}
/** The only way into the private-notes code: a lazy chunk, and no import at all in a build without the switch. */
export const loadPrivateNotes: (() => Promise<typeof import("./privateNotes")>) | null = PRIVATE_NOTES_BUILD ? () => import("./privateNotes") : null
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

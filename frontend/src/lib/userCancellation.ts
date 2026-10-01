/**
 * Whether an error is the user's own cancel: a reject in the wallet or a cancel
 * in Memba's confirmation dialog. Kept apart from errorMessages so the classic
 * shell's activation dialog can ask without loading the whole error catalogue.
 *
 * @module lib/userCancellation
 */
export function isUserCancellation(error: unknown): boolean {
    const raw = typeof error === "string" ? error
        : error instanceof Error ? error.message
            : typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : ""
    return /user (rejected|denied)|rejected by (the )?user|cancelled|canceled/.test(raw.toLowerCase())
}

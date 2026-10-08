/** Same-origin lifecycle barrier. Tokens are acquired before taking a read lock;
 * suspended token requests cannot delay deletion or dispatch after its barrier.
 * Once a request is sent, hold its lock until it settles (do not equate query
 * cancellation with server cancellation). Deletion takes the exclusive lock. */
import type { AccountApi } from "./accountContext"
import { AccountApiError } from "../lib/accountApi"
import { beginDeletion, getDeletion } from "../os/account/deletion"

const lockName = (userId: string) => `memba-account:${userId}`
export function requireDeletionCoordination() {
    if (!navigator.locks) throw new Error("Account deletion needs a browser with cross-tab locking. Use a supported browser and try again.")
}
export async function withDeletionLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
    requireDeletionCoordination()
    return navigator.locks.request(lockName(userId), { mode: "exclusive" }, run)
}
export function assertAccountReadable(userId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (getDeletion(userId)) throw new Error("Account deletion is in progress. Finish it in Settings → Account.")
}
export async function accountRequest<T>(account: AccountApi, run: (token: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const userId = account.user?.id
    if (!userId) throw new Error("You are signed out.")
    account.assertCurrentUser(userId)
    assertAccountReadable(userId, signal)
    const token = await account.getToken(userId)
    assertAccountReadable(userId, signal)
    if (!token) throw new Error("Your sign-in changed. Try again with the current account.")
    const dispatch = async () => {
        assertAccountReadable(userId, signal)
        account.assertCurrentUser(userId)
        const result = await run(token)
        assertAccountReadable(userId, signal)
        // Never expose a response from a previous identity generation.
        account.assertCurrentUser(userId)
        assertAccountReadable(userId, signal)
        return result
    }
    // Older browsers retain alerts access. Destructive account deletion is
    // refused there, because a tab-local lock cannot protect other tabs.
    try {
        return await (navigator.locks ? navigator.locks.request(lockName(userId), { mode: "shared" }, dispatch) : dispatch())
    } catch (error) {
        if (error instanceof AccountApiError && error.status === 410 && error.code === "account_deleted") {
            // A different device may already have deleted this account. Pause
            // reads durably; a manual resume repeats the idempotent backend step
            // before cleaning up monitoring and this exact Clerk identity.
            beginDeletion(userId, false)
        }
        throw error
    }
}

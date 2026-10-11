import { useSyncExternalStore } from 'react'
import type { FreePlaySession } from './session'

/** The owner creates one session per completed run and disposes it on removal.
 * Identity transitions invalidate through the injected subscription; the API checks identity
 * before every request and after every asynchronous boundary. */
export function useFreePlayResult(session: FreePlaySession) {
    return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
}

import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { NotesCryptoError } from '../../../../lib/notes/crypto/bytes'

const queues = new WeakMap<NotesIdentityController, Promise<unknown>>()
/**
 * The key controller runs one operation at a time and refuses an overlapping one (`busy`). The private views of one
 * window queue their reads here, and wait briefly while another part of the window (Unlock, a refresh) holds the key.
 */
export function withKey<T>(controller: NotesIdentityController, work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
        for (let attempt = 0; ; attempt++) {
            try { return await work() } catch (error) {
                if (!(error instanceof NotesCryptoError && error.code === 'busy') || attempt >= 20) throw error
                await new Promise(resolve => setTimeout(resolve, 150))
            }
        }
    }
    const next = (queues.get(controller) ?? Promise.resolve()).then(run, run)
    queues.set(controller, next.catch(() => {}))
    return next
}

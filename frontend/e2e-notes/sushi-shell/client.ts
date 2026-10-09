/** Simulated reads only. The real reader, composer and session lifetime stay in production modules. */
import type { NotesReadContext } from '../../src/lib/notes/chain/client.ts'
import type { ChainNote } from '../../src/lib/notes/chain/schema'
import { audit, NOTE_ID } from './audit'
import { TEST_OWNER } from './session'
import recipe from '../sushi/recipe.md?raw'
const bytes = (text: string) => new TextEncoder().encode(text)
export class NotesReadClient {
    readonly chainId: string
    constructor(private context: NotesReadContext) { this.chainId = context.chainId; audit.clients.push(context) }
    assertCurrent() { if (!this.context.isCurrent()) throw new Error('Fixture read lifetime ended') }
    async note(id: string): Promise<ChainNote | null> {
        this.assertCurrent()
        return id === NOTE_ID ? { id, owner: TEST_OWNER, pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0', title: bytes('Sushi Shell demonstration'), body: bytes(recipe), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: '75'.repeat(16), actor: TEST_OWNER, height: '1' } : null
    }
    async publicNotes() { return { items: [await this.note(NOTE_ID)], nextCursor: '' } }
    async commentsRaw() { this.assertCurrent(); return { items: [], next_cursor: '' } }
}

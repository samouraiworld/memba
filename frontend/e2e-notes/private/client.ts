/** Simulated onyx-1 reads only (no write path exists here). Reader, controller, crypto, drafts and signing sheets stay production code. */
import type { NotesReadContext } from '../../src/lib/notes/chain/client.ts'
import type { ChainNote } from '../../src/lib/notes/chain/schema'
import { accounts, NOTE_ID, readers, REALM, world, wrapFor, writers } from './world'

const RPC = 'https://rpc.onyx.testnets.gno.land:443', REKEYED = new URLSearchParams(location.search).get('rekeyed') === '1'
const meta = (note: ChainNote): ChainNote => ({ ...note, body: undefined })
export const audit = { clients: [] as Array<{ isCurrent(): boolean }> }
export class NotesReadClient {
    readonly chainId: string
    readonly realm: string
    constructor(private context: NotesReadContext) { this.chainId = context.chainId; this.realm = context.deployment.realm; audit.clients.push(context) }
    assertCurrent() { if (!this.context.isCurrent()) throw new Error('Fixture read lifetime ended') }
    private async live<T>(value: T): Promise<T> { await Promise.resolve(); this.assertCurrent(); return structuredClone(value) }
    nodes() { return [RPC] }
    async simulateRaw(): Promise<Uint8Array> { throw new Error('Fixture: no simulation, the bounded estimate applies') }
    async note(id: string) { return this.live(id === NOTE_ID ? world.note : null) }
    async noteMetadata(id: string) { return this.live(id === NOTE_ID ? meta(world.note) : null) }
    async byOwner(owner: string) { return this.live({ items: owner === world.note.owner ? [meta(world.note)] : [], nextCursor: '' }) }
    async sharedWith(owner: string) { return this.live({ items: readers().includes(owner) ? [meta(world.note)] : [], nextCursor: '' }) }
    async publicNotes() { return this.live({ items: [], nextCursor: '' }) }
    async commentsRaw() { return this.live({ items: [], next_cursor: '' }) }
    async getCommentRaw() { return this.live(null) }
    async config() { return this.live({ realm: REALM, admin: accounts.owner.address, pendingAdmin: '', treasury: accounts.owner.address, createFeeUgnot: '100000', paused: false }) }
    async height() { return this.live('100') }
    async blockTimeMs() { return this.live(null) }
    async key(owner: string) {
        // ?rekeyed=1: another app registered generation 2 for the owner in the shared registry; Notes keeps the generation 1 backup.
        if (REKEYED && owner === accounts.owner.address) return this.live({ ...world.keys.get(owner)!, generation: '2', publicKey: new Uint8Array(1216).fill(9), operationId: '0e'.repeat(16), height: '50' })
        return this.live(world.keys.get(owner) ?? { address: owner, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' })
    }
    async seedBackupRaw(owner: string) { return this.live(world.backups.get(owner) ?? null) }
    async epochMetadataRaw() { return this.live({ items: [{ epoch: '1', commitment: btoa(String.fromCharCode(...world.note.commitment)), revealed_key: '' }], next_cursor: '1' }) }
    async wrapRaw(_id: string, _epoch: string, who: string) { return this.live(wrapFor(who)) }
    async readersRaw() { return this.live(readers()) }
    async writersRaw() { return this.live(writers()) }
}

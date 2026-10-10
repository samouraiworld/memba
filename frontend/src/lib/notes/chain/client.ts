import { GNO_CHAIN_ID } from '../../config'
import { assertRpcChain } from '../../dao/chainIdentity'
import { directRpcCall, getRpcUrlsInOrder, resilientAbciQueryDetailed } from '../../rpcFallback'
import { address, blob, check, cursor, decimal, decodeResponse, encode64, id, KEY_SUITE, NOTES_REALM, NOTES_REGISTRY, NotesChainError, parseConfig, parseKey, parseNote, parsePage, record } from './schema'
import type { ChainNote, NotesPage } from './schema'
import { parsePublicCapabilities } from './capabilities'
import { historyPageArgs, parseHistoryEntry, parseHistoryInfo, parseHistoryPage } from './history'
import { historyChunkArgs, parseHistoryBodyChunk, parseHistoryComment, parseHistoryVersion } from './historyContent'

export interface NotesDeployment { realm: string; version: 1 }
export interface NotesReadContext {
  chainId: string
  deployment: NotesDeployment
  /** Snapshot of configured RPC URLs; each fallback is checked before any query. */
  rpcUrls: readonly string[]
  isCurrent: () => boolean
}
export class NotesReadClient {
  readonly chainId: string
  readonly realm = NOTES_REALM
  private readonly rpcUrls: ReadonlySet<string>
  private readonly isCurrent: () => boolean
  constructor(context: NotesReadContext) {
    check(context.deployment?.realm === NOTES_REALM && context.deployment.version === 1)
    if (context.chainId !== GNO_CHAIN_ID) throw new NotesChainError('network')
    const configured = getRpcUrlsInOrder()
    check(context.rpcUrls.length > 0 && context.rpcUrls.length <= 10 && context.rpcUrls.every(url => configured.includes(url)))
    this.chainId = context.chainId; this.rpcUrls = new Set(context.rpcUrls); this.isCurrent = context.isCurrent
    this.assertCurrent()
  }
  assertCurrent(): void {
    if (!this.isCurrent()) throw new NotesChainError('session')
    if (this.chainId !== GNO_CHAIN_ID) throw new NotesChainError('network')
  }
  private async query(realm: typeof NOTES_REALM | typeof NOTES_REGISTRY, expression: string): Promise<unknown> {
    this.assertCurrent()
    const result = await resilientAbciQueryDetailed('vm/qeval', `${realm}.${expression}`, async url => {
      this.assertCurrent()
      if (!this.rpcUrls.has(url) || !getRpcUrlsInOrder().includes(url)) throw new NotesChainError('network')
      await assertRpcChain(url, this.chainId)
      this.assertCurrent()
    })
    this.assertCurrent()
    if (result.kind !== 'ok') throw new NotesChainError('unavailable')
    return decodeResponse(result.text)
  }
  async note(noteId: string): Promise<ChainNote | null> {
    const wanted = id(noteId), expression = `NoteMetaJSON("${wanted}")`
    const value = await this.query(NOTES_REALM, expression)
    if (value === null) return null
    const note = parseNote(value, false); check(note.id === wanted && note.bodyBytes !== undefined)
    const body = new Uint8Array(note.bodyBytes)
    try {
      for (let offset = 0; offset < body.length;) {
        const raw = await this.query(NOTES_REALM, `NoteBodyChunkJSON("${wanted}",${note.stateRevision},${offset},8192)`)
        const chunk = record(raw, ['id', 'state_revision', 'body_revision', 'epoch', 'offset', 'total', 'next_offset', 'chunk_blob'])
        if (id(chunk.id) !== wanted || decimal(chunk.state_revision, 64, true) !== note.stateRevision || decimal(chunk.body_revision, 64, true) !== note.bodyRevision || decimal(chunk.epoch, 32) !== note.epoch) throw new NotesChainError('stale')
        check(decimal(chunk.offset, 32) === String(offset) && decimal(chunk.total, 32) === String(body.length))
        const bytes = blob(chunk.chunk_blob, 8192), next = offset + bytes.length
        check(bytes.length === Math.min(8192, body.length - offset) && decimal(chunk.next_offset, 32) === String(next))
        body.set(bytes, offset); offset = next
      }
      const final = await this.query(NOTES_REALM, expression)
      if (final === null || JSON.stringify(parseNote(final, false)) !== JSON.stringify(note)) throw new NotesChainError('stale')
      // UTF-8 validation happens only after concatenation: chunks may split a code point.
      return parseNote({ ...(value as Record<string, unknown>), body_blob: encode64(body) })
    } finally { body.fill(0) }
  }
  async sharedWith(owner: string, pageCursor = '', limit = 20): Promise<NotesPage> {
    const who = address(owner); this.pageArgs(pageCursor, limit)
    const page = parsePage(await this.query(NOTES_REALM, `ListSharedWithJSON(address("${who}"),"${pageCursor}",${limit})`), limit)
    check(page.items.every(item => !item.deleted)); return page
  }
  async byOwner(owner: string, pageCursor = '', limit = 20): Promise<NotesPage> {
    const who = address(owner); this.pageArgs(pageCursor, limit)
    const page = parsePage(await this.query(NOTES_REALM, `ListByOwnerJSON(address("${who}"),"${pageCursor}",${limit})`), limit)
    check(page.items.every(item => item.owner === who && !item.deleted)); return page
  }
  /** Raw transport for the independently bounded comments schema. */
  async commentsRaw(noteId: string, pageCursor = '', limit = 5): Promise<unknown> {
    const wanted = id(noteId); this.pageArgs(pageCursor, limit); check(limit <= 5)
    return this.query(NOTES_REALM, `CommentsJSON("${wanted}","${pageCursor}",${limit})`)
  }
  async getCommentRaw(noteId: string, commentId: string): Promise<unknown> {
    return this.query(NOTES_REALM, `CommentJSON("${id(noteId)}","${id(commentId)}")`)
  }
  async publicNotes(pageCursor = '', limit = 20): Promise<NotesPage> {
    this.pageArgs(pageCursor, limit)
    const page = parsePage(await this.query(NOTES_REALM, `ListPublicJSON("${pageCursor}",${limit})`), limit)
    check(page.items.every(item => item.mode >= 3 && item.listed && !item.deleted)); return page
  }
  async config() { return parseConfig(await this.query(NOTES_REALM, 'ConfigJSON()')) }
  /** Fresh status includes chain identity, avoiding a cached identity check for quote expiry. */
  async height(): Promise<string> {
    this.assertCurrent()
    for (const url of getRpcUrlsInOrder().filter(url => this.rpcUrls.has(url))) {
      try {
        const value = await directRpcCall(url, 'status') as { node_info?: { network?: unknown }; sync_info?: { latest_block_height?: unknown; catching_up?: unknown } }
        this.assertCurrent()
        if (value?.node_info?.network !== this.chainId) throw new NotesChainError('network')
        check(value.sync_info?.catching_up === false)
        return decimal(value.sync_info?.latest_block_height, 63, true)
      } catch (error) { this.assertCurrent(); if (error instanceof NotesChainError) throw error }
    }
    throw new NotesChainError('unavailable')
  }
  async key(owner: string) {
    const who = address(owner)
    return parseKey(await this.query(NOTES_REGISTRY, `KeyJSON(address("${who}"),"${KEY_SUITE}")`), who)
  }
  /** Identity modules perform the bounded binary/header validation lazily. */
  async seedBackupRaw(owner: string, generation?: string): Promise<unknown> {
    const who = address(owner)
    return this.query(NOTES_REALM, generation === undefined ? `SeedBackupJSON(address("${who}"))` : `SeedBackupAtJSON(address("${who}"),${decimal(generation, 64, true)})`)
  }
  async noteMetadata(noteId: string): Promise<ChainNote | null> {
    const wanted = id(noteId), raw = await this.query(NOTES_REALM, `NoteMetaJSON("${wanted}")`)
    if (raw === null) return null
    const note = parseNote(raw, false); check(note.id === wanted && note.bodyBytes !== undefined); return note
  }
  /** One small epoch metadata record; never fetch the potentially 41KiB manifest here. */
  async epochMetadataRaw(noteId: string, epoch: string): Promise<unknown> {
    return this.query(NOTES_REALM, `EpochsJSON("${id(noteId)}",${BigInt(decimal(epoch, 32, true)) - 1n},1)`)
  }
  async wrapRaw(noteId: string, epoch: string, reader: string): Promise<unknown> {
    return this.query(NOTES_REALM, `WrapJSON("${id(noteId)}",${decimal(epoch, 32, true)},address("${address(reader)}"))`)
  }
  async writersRaw(noteId: string): Promise<unknown> {
    return this.query(NOTES_REALM, `WritersJSON("${id(noteId)}")`)
  }
  async publicCapabilities(noteId: string) {
    const wanted = id(noteId), value = await this.query(NOTES_REALM, `PublicCapabilitiesJSON("${wanted}")`)
    const capabilities = parsePublicCapabilities(value)
    check(capabilities === null || capabilities.id === wanted)
    return capabilities
  }
  async publicHistoryInfo(noteId: string) {
    const wanted = id(noteId)
    return parseHistoryInfo(await this.query(NOTES_REALM, `PublicHistoryInfoJSON("${wanted}")`), wanted)
  }
  async publicHistory(noteId: string, afterSeq = '0', throughSeq = '0', limit = 20) {
    const wanted = id(noteId); historyPageArgs(afterSeq, throughSeq, limit)
    return parseHistoryPage(await this.query(NOTES_REALM, `PublicHistoryJSON("${wanted}",${afterSeq},${throughSeq},${limit})`), wanted, afterSeq, throughSeq, limit)
  }
  async publicHistoryEntry(noteId: string, seq: string) {
    const wanted = id(noteId), sequence = decimal(seq, 64, true)
    return parseHistoryEntry(await this.query(NOTES_REALM, `PublicHistoryEntryJSON("${wanted}",${sequence})`), wanted, sequence)
  }
  async publicHistoryVersion(noteId: string, stateRevision: string) {
    const wanted = id(noteId), revision = decimal(stateRevision, 64, true)
    return parseHistoryVersion(await this.query(NOTES_REALM, `PublicHistoryVersionJSON("${wanted}",${revision})`), wanted, revision)
  }
  async publicHistoryBodyChunk(noteId: string, bodyRevision: string, offset = 0, limit = 8192) {
    const wanted = id(noteId), revision = decimal(bodyRevision, 64, true); historyChunkArgs(offset, limit)
    return parseHistoryBodyChunk(await this.query(NOTES_REALM, `PublicHistoryBodyChunkJSON("${wanted}",${revision},${offset},${limit})`), wanted, revision, offset, limit)
  }
  async publicHistoryComment(noteId: string, commentId: string) {
    const wanted = id(noteId), cid = id(commentId)
    return parseHistoryComment(await this.query(NOTES_REALM, `PublicHistoryCommentJSON("${wanted}","${cid}")`), wanted, cid)
  }
  async readersRaw(noteId: string): Promise<unknown> {
    return this.query(NOTES_REALM, `ReadersJSON("${id(noteId)}")`)
  }
  private pageArgs(pageCursor: string, limit: number): void {
    cursor(pageCursor); check(Number.isInteger(limit) && limit >= 1 && limit <= 50)
  }
}

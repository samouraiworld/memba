/** Transactional, device-local drafts. A failed write never means "saved". */
export interface NotesPartition { chainId: string; realm: string; owner: string }
export interface NotesScope extends NotesPartition { noteId: string }
/** Frozen when editing a chain revision; never advance it just to make a publish succeed. */
export interface DraftBase { stateRevision: string; epoch: string; ownerGeneration: string; titleRevision: string; bodyRevision: string }
export type DraftPayload = { kind: "public"; title: string; body: string; base?: DraftBase } | { kind: "encrypted"; envelope: Uint8Array }
export interface DraftRecord { schema: 1; scope: NotesScope; localRevision: string; payload: DraftPayload; updatedAt: number }
export type NotesWriteResult<T> = { status: "saved"; value: T } | { status: "conflict" | "unavailable" | "session-changed" | "invalid" }
export interface DraftWriteGuard { readonly signal: AbortSignal }
export interface DraftSession extends DraftWriteGuard { invalidate(): void; capture(): DraftWriteGuard }
export interface NotesStoreOptions { databaseName?: string; indexedDB?: IDBFactory }
export const MAX_NOTE_BODY_BYTES = 131_072
const MAX_ENVELOPE_BYTES = 262_144
const encoder = new TextEncoder()
const MAX_UINT64 = 18_446_744_073_709_551_615n

export function isNotesRevision(value: unknown): value is string {
    return typeof value === "string" && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= MAX_UINT64
}
export function notesKey(scope: NotesScope): string { return JSON.stringify([scope.chainId, scope.realm, scope.owner, scope.noteId]) }
export function notesPartitionKey(scope: NotesPartition): string { return JSON.stringify([scope.chainId, scope.realm, scope.owner]) }
export function validNotesPartition(scope: NotesPartition): boolean {
    return [scope.chainId, scope.realm, scope.owner].every(value => typeof value === "string" && value.length > 0 && value.length <= 512)
}
export function validNotesScope(scope: NotesScope): boolean { return validNotesPartition(scope) && /^[a-f0-9]{32}$/.test(scope.noteId) }
export function createDraftSession(): DraftSession {
    let controller = new AbortController()
    return { get signal() { return controller.signal }, capture() { return { signal: controller.signal } }, invalidate() { controller.abort(); controller = new AbortController() } }
}
function validPayload(payload: DraftPayload): boolean {
    return payload?.kind === "public"
        ? typeof payload.title === "string" && encoder.encode(payload.title).length <= 320 && typeof payload.body === "string" && encoder.encode(payload.body).length <= MAX_NOTE_BODY_BYTES && (payload.base === undefined || validBase(payload.base))
        : payload?.kind === "encrypted" && ArrayBuffer.isView(payload.envelope) && Object.prototype.toString.call(payload.envelope) === "[object Uint8Array]" && payload.envelope.length > 0 && payload.envelope.length <= MAX_ENVELOPE_BYTES
}
function validBase(base: DraftBase): boolean {
    return !!base && [base.stateRevision, base.ownerGeneration, base.titleRevision, base.bodyRevision].every(value => isNotesRevision(value) && value !== "0")
        && isNotesRevision(base.epoch) && BigInt(base.epoch) <= 4_294_967_295n
}
function copyPayload(payload: DraftPayload): DraftPayload {
    if (payload.kind === "encrypted") return { kind: "encrypted", envelope: new Uint8Array(payload.envelope) }
    const { base } = payload
    return { kind: "public", title: payload.title, body: payload.body, ...(base ? { base: {
        stateRevision: base.stateRevision, epoch: base.epoch, ownerGeneration: base.ownerGeneration,
        titleRevision: base.titleRevision, bodyRevision: base.bodyRevision,
    } } : {}) }
}
function copyScope(scope: NotesScope): NotesScope { return { chainId: scope.chainId, realm: scope.realm, owner: scope.owner, noteId: scope.noteId } }
function validDraft(value: unknown): value is DraftRecord {
    if (!value || typeof value !== "object") return false
    const draft = value as DraftRecord
    return draft.schema === 1 && !!draft.scope && validNotesScope(draft.scope) && isNotesRevision(draft.localRevision) && validPayload(draft.payload) && Number.isSafeInteger(draft.updatedAt) && draft.updatedAt >= 0
}
function publicRecord(value: DraftRecord): DraftRecord {
    return { schema: 1, scope: copyScope(value.scope), localRevision: value.localRevision, payload: copyPayload(value.payload), updatedAt: value.updatedAt }
}

/** Shared connection for drafts and receipts; opening it never requests wallet access. */
export class NotesDatabase {
    private pending: Promise<IDBDatabase> | undefined
    constructor(private options: NotesStoreOptions = {}) {}
    open(): Promise<IDBDatabase> {
        if (this.pending) return this.pending
        const promise = new Promise<IDBDatabase>((resolve, reject) => {
            let request: IDBOpenDBRequest
            try { request = (this.options.indexedDB ?? globalThis.indexedDB).open(this.options.databaseName ?? "memba_notes_local_v1", 1) }
            catch { reject(new Error("Device storage is unavailable.")); return }
            let rejected = false
            const fail = () => { rejected = true; reject(new Error("Device storage is unavailable.")) }
            request.onerror = fail
            request.onblocked = fail
            request.onupgradeneeded = () => {
                for (const name of ["drafts", "intents"]) {
                    const store = request.result.createObjectStore(name, { keyPath: "key" })
                    store.createIndex("partition", "partition")
                }
            }
            request.onsuccess = () => {
                const database = request.result
                if (rejected) { database.close(); return }
                database.onversionchange = () => { database.close(); this.pending = undefined }
                resolve(database)
            }
        })
        this.pending = promise
        void promise.catch(() => { if (this.pending === promise) this.pending = undefined })
        return promise
    }
    async close(): Promise<void> {
        const pending = this.pending
        this.pending = undefined
        try { (await pending)?.close() } catch { /* An unavailable database has no connection to close. */ }
    }
}

/** Resolve only at transaction completion, including quota/commit-time failures. */
export async function notesWrite<T>(database: NotesDatabase, stores: string[], signal: AbortSignal, work: (tx: IDBTransaction, finish: (result: NotesWriteResult<T>) => void) => void): Promise<NotesWriteResult<T>> {
    if (signal.aborted) return { status: "session-changed" }
    try {
        const db = await database.open()
        if (signal.aborted) return { status: "session-changed" }
        return await new Promise<NotesWriteResult<T>>(resolve => {
            const tx = db.transaction(stores, "readwrite")
            let result: NotesWriteResult<T> = { status: "unavailable" }
            const abort = () => { try { tx.abort() } catch { /* Already completed. */ } }
            const settle = (value: NotesWriteResult<T>) => { signal.removeEventListener("abort", abort); resolve(value) }
            signal.addEventListener("abort", abort, { once: true })
            tx.oncomplete = () => settle(signal.aborted ? { status: "session-changed" } : result)
            tx.onabort = () => settle({ status: signal.aborted ? "session-changed" : "unavailable" })
            tx.onerror = () => { /* onabort is the authoritative rollback result. */ }
            try { work(tx, value => { result = value }) } catch { abort() }
        })
    } catch { return { status: signal.aborted ? "session-changed" : "unavailable" } }
}

export async function notesRead<T>(database: NotesDatabase, storeName: string, read: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
        const db = await database.open()
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly")
            const request = read(tx.objectStore(storeName))
            tx.oncomplete = () => resolve(request.result)
            tx.onabort = () => reject(new Error("Device storage is unavailable."))
            tx.onerror = () => { /* Wait for rollback. */ }
        })
    } catch { throw new Error("Device storage is unavailable.") }
}

/** A synchronous storage exception in a request callback must roll back without escaping. */
export function notesRequest<T>(request: IDBRequest<T>, tx: IDBTransaction, handle: (value: T) => void): void {
    request.onsuccess = () => { try { handle(request.result) } catch { try { tx.abort() } catch { /* Already aborted. */ } } }
}

export class NotesStore {
    readonly database: NotesDatabase
    constructor(options: NotesStoreOptions = {}) { this.database = new NotesDatabase(options) }
    close(): Promise<void> { return this.database.close() }
    async getDraft(scope: NotesScope): Promise<DraftRecord | null> {
        if (!validNotesScope(scope)) throw new Error("Invalid draft location.")
        const storageKey = notesKey(scope)
        const value = await notesRead<unknown>(this.database, "drafts", store => store.get(storageKey))
        if (value === undefined) return null
        if (!validDraft(value) || notesKey(value.scope) !== storageKey) throw new Error("This draft could not be read. Its stored copy was kept.")
        return publicRecord(value)
    }
    async listDrafts(partition: NotesPartition): Promise<DraftRecord[]> {
        if (!validNotesPartition(partition)) throw new Error("Invalid draft location.")
        const partitionKey = notesPartitionKey(partition)
        const values = await notesRead<unknown[]>(this.database, "drafts", store => store.index("partition").getAll(partitionKey))
        if (values.some(value => !validDraft(value) || notesPartitionKey(value.scope) !== partitionKey)) throw new Error("Some drafts could not be read. Their stored copies were kept.")
        return (values as DraftRecord[]).map(publicRecord).sort((a, b) => b.updatedAt - a.updatedAt)
    }
    saveDraft(scope: NotesScope, expectedRevision: string, payload: DraftPayload, session: DraftWriteGuard): Promise<NotesWriteResult<DraftRecord>> {
        const signal = session.signal
        if (!validNotesScope(scope) || !isNotesRevision(expectedRevision) || expectedRevision === String(MAX_UINT64) || !validPayload(payload)) return Promise.resolve({ status: "invalid" })
        // Snapshot before awaiting storage: edits after this call belong to a later save.
        const next: DraftRecord = { schema: 1, scope: copyScope(scope), localRevision: String(BigInt(expectedRevision) + 1n), payload: copyPayload(payload), updatedAt: Date.now() }
        return notesWrite(this.database, ["drafts"], signal, (tx, finish) => {
            const store = tx.objectStore("drafts")
            notesRequest(store.get(notesKey(next.scope)), tx, (current: unknown) => {
                if (current !== undefined && (!validDraft(current) || notesKey(current.scope) !== notesKey(next.scope))) { finish({ status: "invalid" }); return }
                if ((current === undefined ? "0" : current.localRevision) !== expectedRevision) { finish({ status: "conflict" }); return }
                store.put({ ...next, key: notesKey(next.scope), partition: notesPartitionKey(next.scope) })
                finish({ status: "saved", value: next })
            })
        })
    }
    /** Copy (optionally encrypted by the caller) and remove the guest copy atomically. */
    adoptDraft(from: NotesScope, to: NotesScope, expectedSourceRevision: string, payload: DraftPayload, session: DraftWriteGuard): Promise<NotesWriteResult<DraftRecord>> {
        const signal = session.signal
        if (!validNotesScope(from) || !validNotesScope(to) || from.owner !== "guest" || to.owner === "guest" || from.chainId !== to.chainId || from.realm !== to.realm || from.noteId !== to.noteId || !isNotesRevision(expectedSourceRevision) || !validPayload(payload)) return Promise.resolve({ status: "invalid" })
        const next: DraftRecord = { schema: 1, scope: copyScope(to), localRevision: "1", payload: copyPayload(payload), updatedAt: Date.now() }
        const sourceKey = notesKey(from)
        return notesWrite(this.database, ["drafts"], signal, (tx, finish) => {
            const store = tx.objectStore("drafts")
            notesRequest(store.get(sourceKey), tx, (source: unknown) => {
                if (!validDraft(source) || notesKey(source.scope) !== sourceKey || source.localRevision !== expectedSourceRevision) { finish({ status: "conflict" }); return }
                notesRequest(store.get(notesKey(next.scope)), tx, (target: unknown) => {
                    if (target !== undefined) { finish({ status: "conflict" }); return }
                    store.put({ ...next, key: notesKey(next.scope), partition: notesPartitionKey(next.scope) })
                    store.delete(sourceKey)
                    finish({ status: "saved", value: next })
                })
            })
        })
    }
    /** Expected revision protects edits made after the transaction being confirmed. */
    deleteDraft(scope: NotesScope, expectedRevision: string, session: DraftWriteGuard): Promise<NotesWriteResult<null>> {
        if (!validNotesScope(scope) || !isNotesRevision(expectedRevision)) return Promise.resolve({ status: "invalid" })
        const storageKey = notesKey(scope)
        return notesWrite(this.database, ["drafts"], session.signal, (tx, finish) => {
            const store = tx.objectStore("drafts")
            notesRequest(store.get(storageKey), tx, (value: unknown) => {
                if (!validDraft(value) || notesKey(value.scope) !== storageKey || value.localRevision !== expectedRevision) { finish({ status: "conflict" }); return }
                store.delete(storageKey); finish({ status: "saved", value: null })
            })
        })
    }
}
export function createNotesStore(options?: NotesStoreOptions): NotesStore { return new NotesStore(options) }

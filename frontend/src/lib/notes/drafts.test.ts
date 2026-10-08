import { afterEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import { createDraftSession, createNotesStore, isNotesRevision, notesKey, type NotesScope, type NotesStore } from "./drafts"
import { createNotesIntents, reconcileNotesIntent } from "./intents"

const scope: NotesScope = { chainId: "gnoland-1", realm: "gno.land/r/example/notes", owner: "alice", noteId: "ab".repeat(16) }
const payload = { kind: "public" as const, title: "Draft", body: "Text on this device" }
const stores: NotesStore[] = []
function store(indexedDB = new IDBFactory()) {
    const value = createNotesStore({ indexedDB, databaseName: "notes-tests" }); stores.push(value); return value
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(value => value.close())) })

describe("transactional Notes drafts", () => {
    it("freezes the chain baseline with a draft and rejects malformed baselines", async () => {
        const first = store(), session = createDraftSession()
        const base = { stateRevision: "9", epoch: "0", ownerGeneration: "2", titleRevision: "2", bodyRevision: "5" }
        const write = first.saveDraft(scope, "0", { ...payload, base }, session)
        base.stateRevision = "10"
        expect((await write).status).toBe("saved")
        expect((await first.getDraft(scope))?.payload).toMatchObject({ base: { stateRevision: "9" } })
        for (const bad of [{ stateRevision: "0" }, { epoch: "4294967296" }, { bodyRevision: "01" }, { ownerGeneration: "-1" }]) {
            expect(await first.saveDraft(scope, "1", { ...payload, base: { ...base, ...bad } }, session)).toEqual({ status: "invalid" })
        }
        expect((await first.getDraft(scope))?.localRevision).toBe("1")
    })
    it("persists a public draft across connections and scopes account, realm and chain", async () => {
        const factory = new IDBFactory(), session = createDraftSession(), first = store(factory)
        const saved = await first.saveDraft(scope, "0", payload, session)
        expect(saved).toMatchObject({ status: "saved", value: { localRevision: "1", payload } })
        await first.close()
        const second = store(factory)
        expect(await second.getDraft(scope)).toMatchObject({ payload, localRevision: "1" })
        for (const change of [{ chainId: "onyx-1" }, { realm: "other" }, { owner: "bob" }]) expect(await second.getDraft({ ...scope, ...change })).toBeNull()
        expect(await second.listDrafts(scope)).toHaveLength(1)
        expect(await second.listDrafts({ ...scope, owner: "bob" })).toEqual([])
    })
    it("serializes concurrent read/compare/write transactions from two connections", async () => {
        const factory = new IDBFactory(), first = store(factory), second = store(factory), session = createDraftSession()
        await first.saveDraft(scope, "0", payload, session)
        const results = await Promise.all([first.saveDraft(scope, "1", { ...payload, body: "A" }, session), second.saveDraft(scope, "1", { ...payload, body: "B" }, session)])
        expect(results.map(value => value.status).sort()).toEqual(["conflict", "saved"])
        expect(await first.getDraft(scope)).toMatchObject({ localRevision: "2" })
    })
    it("returns unavailable on quota and preserves the previous durable revision", async () => {
        const first = store(), session = createDraftSession()
        await first.saveDraft(scope, "0", payload, session)
        const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError") })
        expect(await first.saveDraft(scope, "1", { ...payload, body: "not saved" }, session)).toEqual({ status: "unavailable" })
        put.mockRestore()
        expect(await first.getDraft(scope)).toMatchObject({ localRevision: "1", payload })
    })
    it("does not claim saved when the transaction aborts after the write request succeeds", async () => {
        const first = store(), session = createDraftSession()
        const original = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = original.apply(this, args)
            request.addEventListener("success", () => this.transaction.abort())
            return request
        })
        expect(await first.saveDraft(scope, "0", payload, session)).toEqual({ status: "unavailable" })
        put.mockRestore()
        expect(await first.getDraft(scope)).toBeNull()
    })
    it("aborts a pending session and an in-flight transaction on account/network lock", async () => {
        const first = store(), session = createDraftSession()
        const opening = first.saveDraft(scope, "0", payload, session)
        session.invalidate()
        expect(await opening).toEqual({ status: "session-changed" })
        expect(await first.getDraft(scope)).toBeNull()
        const original = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = original.apply(this, args)
            request.addEventListener("success", () => session.invalidate())
            return request
        })
        expect(await first.saveDraft(scope, "0", payload, session)).toEqual({ status: "session-changed" })
        put.mockRestore()
        expect(await first.getDraft(scope)).toBeNull()
        expect((await first.saveDraft(scope, "0", payload, session)).status).toBe("saved")
    })
    it("a guard captured before asynchronous encryption stays cancelled after session invalidation", async () => {
        const first = store(), session = createDraftSession(), guard = session.capture()
        session.invalidate()
        expect(await first.saveDraft(scope, "0", { kind: "encrypted", envelope: new Uint8Array([1]) }, guard)).toEqual({ status: "session-changed" })
        expect(await first.getDraft(scope)).toBeNull()
    })
    it("atomically adopts a guest draft and never overwrites an existing account draft", async () => {
        const first = store(), session = createDraftSession(), guest = { ...scope, owner: "guest" }
        await first.saveDraft(guest, "0", payload, session)
        const result = await first.adoptDraft(guest, scope, "1", payload, session)
        expect(result.status).toBe("saved")
        expect(await first.getDraft(guest)).toBeNull()
        expect(await first.getDraft(scope)).toMatchObject({ localRevision: "1", payload })
        await first.saveDraft(guest, await first.getDraftRevision(guest), { ...payload, body: "second guest copy" }, session)
        expect(await first.adoptDraft(guest, scope, "3", payload, session)).toEqual({ status: "conflict" })
        expect((await first.getDraft(guest))?.payload).toMatchObject({ body: "second guest copy" })
    })
    it("rolls back destination and guest deletion when adoption fails at commit", async () => {
        const first = store(), session = createDraftSession(), guest = { ...scope, owner: "guest" }
        await first.saveDraft(guest, "0", payload, session)
        const original = IDBObjectStore.prototype.put
        const remove = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = original.apply(this, args); if (args[0].deleted === true) request.addEventListener("success", () => this.transaction.abort()); return request
        })
        expect(await first.adoptDraft(guest, scope, "1", payload, session)).toEqual({ status: "unavailable" })
        remove.mockRestore()
        expect(await first.getDraft(guest)).toMatchObject({ payload })
        expect(await first.getDraft(scope)).toBeNull()
    })
    it("guest edits racing adoption preserve either the new source or the adopted destination", async () => {
        const factory = new IDBFactory(), first = store(factory), second = store(factory), session = createDraftSession(), guest = { ...scope, owner: "guest" }
        await first.saveDraft(guest, "0", payload, session)
        const [edit, adopt] = await Promise.all([second.saveDraft(guest, "1", { ...payload, body: "new" }, session), first.adoptDraft(guest, scope, "1", payload, session)])
        expect([edit.status, adopt.status].sort()).toEqual(["conflict", "saved"])
        const remaining = await first.getDraft(guest), destination = await first.getDraft(scope)
        expect(remaining?.payload ?? destination?.payload).toMatchObject({ kind: "public", body: edit.status === "saved" ? "new" : payload.body })
    })
    it("stores encrypted drafts only as an opaque byte envelope and snapshots caller data", async () => {
        const first = store(), session = createDraftSession(), mutableScope = { ...scope }, bytes = new Uint8Array([1, 2, 3])
        const encrypted = { kind: "encrypted" as const, envelope: bytes, accidentalPlaintext: "must not persist" }
        const pending = first.saveDraft(mutableScope, "0", encrypted, session)
        mutableScope.owner = "bob"; bytes.fill(9)
        expect((await pending).status).toBe("saved")
        const saved = await first.getDraft(scope)
        expect(saved?.payload.kind).toBe("encrypted")
        if (saved?.payload.kind === "encrypted") expect(Array.from(saved.payload.envelope)).toEqual([1, 2, 3])
        const db = await first.database.open()
        const raw = await new Promise<unknown>(resolve => { const request = db.transaction("drafts").objectStore("drafts").get(notesKey(scope)); request.onsuccess = () => resolve(request.result) })
        expect(JSON.stringify(raw)).not.toContain("must not persist")
        expect(await first.getDraft(mutableScope)).toBeNull()
    })
    it("retains unknown schemas and reports them instead of pretending a draft is missing", async () => {
        const first = store(), db = await first.database.open()
        await new Promise<void>(resolve => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put({ schema: 9, key: notesKey(scope), scope }); tx.oncomplete = () => resolve() })
        await expect(first.getDraft(scope)).rejects.toThrow("stored copy was kept")
        expect(await first.saveDraft(scope, "0", payload, createDraftSession())).toEqual({ status: "invalid" })
    })
    it("protects newer edits from deletion after an older chain confirmation", async () => {
        const first = store(), session = createDraftSession()
        await first.saveDraft(scope, "0", payload, session); await first.saveDraft(scope, "1", { ...payload, body: "new" }, session)
        expect(await first.deleteDraft(scope, "1", session)).toEqual({ status: "conflict" })
        expect((await first.getDraft(scope))?.localRevision).toBe("2")
        expect(await first.deleteDraft(scope, "2", session)).toEqual({ status: "saved", value: null })
    })
    it("retains payload-free deletion generations across connections and requires explicit recreation", async () => {
        const factory = new IDBFactory(), first = store(factory), session = createDraftSession()
        expect(await first.getDraftRevision(scope)).toBe("0")
        await first.saveDraft(scope, "0", payload, session)
        await first.deleteDraft(scope, "1", session)
        expect(await first.getDraft(scope)).toBeNull()
        expect(await first.listDrafts(scope)).toEqual([])
        const db = await first.database.open()
        const raw = await new Promise<unknown>(resolve => { const request = db.transaction("drafts").objectStore("drafts").get(notesKey(scope)); request.onsuccess = () => resolve(request.result) })
        expect(raw).toEqual({ schema: 1, deleted: true, key: notesKey(scope), scope, localRevision: "2" })
        await first.close()
        const second = store(factory)
        expect(await second.getDraftRevision(scope)).toBe("2")
        expect(await second.saveDraft(scope, "0", payload, session)).toEqual({ status: "conflict" })
        expect(await second.saveDraft(scope, "1", payload, session)).toEqual({ status: "conflict" })
        expect(await second.deleteDraft(scope, "1", session)).toEqual({ status: "conflict" })
        expect(await second.saveDraft(scope, "2", { ...payload, body: "New incarnation" }, session)).toMatchObject({ status: "saved", value: { localRevision: "3" } })
        expect(await first.saveDraft(scope, "1", payload, session)).toEqual({ status: "conflict" })
        await second.deleteDraft(scope, "3", session)
        expect(await second.getDraftRevision(scope)).toBe("4")
    })
    it("never lets an old unknown operation delete or overwrite a recreated draft", async () => {
        const first = store(), session = createDraftSession(), intents = createNotesIntents(first)
        await first.saveDraft(scope, "0", payload, session)
        const input = { scope, operationId: "cd".repeat(16), requestDigest: "ef".repeat(32), actor: scope.owner, action: "Commit",
            expectedStateRevision: "1", resultingStateRevision: "2", expectedEpoch: "1", ownerGeneration: "1", draftLocalRevision: "1" }
        await intents.begin(input, session); await intents.settle(scope, input.operationId, "unknown", session)
        await first.deleteDraft(scope, "1", session)
        await first.saveDraft(scope, await first.getDraftRevision(scope), { ...payload, body: "Unpublished new work" }, session)
        const intent = await intents.get(scope, input.operationId)
        expect(intent).not.toBeNull()
        const reconciliation = reconcileNotesIntent(intent!, { scope, operationId: input.operationId, actor: scope.owner, stateRevision: "2", height: "3", outcome: "applied" }, (await first.getDraft(scope))!.localRevision)
        expect(reconciliation).toEqual({ status: "confirmed" })
        expect(await first.deleteDraft(scope, input.draftLocalRevision, session)).toEqual({ status: "conflict" })
        expect(await first.saveDraft(scope, "1", payload, session)).toEqual({ status: "conflict" })
        expect((await first.getDraft(scope))?.payload).toMatchObject({ body: "Unpublished new work" })
    })
    it("adopts into a deleted destination only with its explicit CAS and preserves both generations", async () => {
        const first = store(), session = createDraftSession(), guest = { ...scope, owner: "guest" }
        await first.saveDraft(scope, "0", payload, session); await first.deleteDraft(scope, "1", session)
        await first.saveDraft(guest, "0", payload, session)
        expect(await first.adoptDraft(guest, scope, "1", payload, session)).toEqual({ status: "conflict" })
        expect(await first.adoptDraft(guest, scope, "1", payload, session, "2")).toMatchObject({ status: "saved", value: { localRevision: "3" } })
        expect(await first.getDraftRevision(guest)).toBe("2")
        expect(await first.saveDraft(guest, "1", payload, session)).toEqual({ status: "conflict" })
        expect(await first.saveDraft(guest, "0", payload, session)).toEqual({ status: "conflict" })
        expect(await first.saveDraft(guest, "2", payload, session)).toMatchObject({ status: "saved", value: { localRevision: "3" } })
        expect(await first.deleteDraft(scope, "1", session)).toEqual({ status: "conflict" })
        // Even an explicitly matching live destination must never be overwritten by adoption.
        expect(await first.adoptDraft(guest, scope, "3", payload, session, "3")).toEqual({ status: "conflict" })
    })
    it("serializes two recreations using the same tombstone and rejects late autosaves", async () => {
        const factory = new IDBFactory(), first = store(factory), second = store(factory), session = createDraftSession()
        await first.saveDraft(scope, "0", payload, session); await first.deleteDraft(scope, "1", session)
        const results = await Promise.all([first.saveDraft(scope, "2", payload, session), second.saveDraft(scope, "2", payload, session), first.saveDraft(scope, "1", payload, session)])
        expect(results.map(result => result.status).sort()).toEqual(["conflict", "conflict", "saved"])
        expect(await second.getDraftRevision(scope)).toBe("3")
    })
    it("reads existing v1 live records without migration or revision reset", async () => {
        const first = store(), session = createDraftSession(), db = await first.database.open()
        await new Promise<void>(resolve => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put({ schema: 1, key: notesKey(scope), partition: JSON.stringify([scope.chainId, scope.realm, scope.owner]), scope, localRevision: "8", payload, updatedAt: 1 }); tx.oncomplete = () => resolve() })
        expect(await first.getDraftRevision(scope)).toBe("8")
        expect(await first.getDraft(scope)).toMatchObject({ payload, localRevision: "8" })
        await first.deleteDraft(scope, "8", session)
        expect(await first.getDraftRevision(scope)).toBe("9")
        expect(await first.saveDraft(scope, "9", payload, session)).toMatchObject({ status: "saved", value: { localRevision: "10" } })
    })
    it("rolls back a failed deletion without consuming its revision or losing content", async () => {
        const first = store(), session = createDraftSession()
        await first.saveDraft(scope, "0", payload, session)
        const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError") })
        expect(await first.deleteDraft(scope, "1", session)).toEqual({ status: "unavailable" })
        put.mockRestore()
        expect(await first.getDraft(scope)).toMatchObject({ localRevision: "1", payload })
        expect(await first.getDraftRevision(scope)).toBe("1")
    })
    it("permits erasing content at uint64 exhaustion but never wraps the revision", async () => {
        const first = store(), session = createDraftSession(), db = await first.database.open(), maximum = "18446744073709551615"
        await new Promise<void>(resolve => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put({ schema: 1, key: notesKey(scope), scope, localRevision: maximum, payload, updatedAt: 1 }); tx.oncomplete = () => resolve() })
        expect(await first.deleteDraft(scope, maximum, session)).toEqual({ status: "saved", value: null })
        expect(await first.getDraft(scope)).toBeNull()
        expect(await first.getDraftRevision(scope)).toBe(maximum)
        expect(await first.saveDraft(scope, maximum, payload, session)).toEqual({ status: "invalid" })
        expect(await first.saveDraft(scope, "0", payload, session)).toEqual({ status: "conflict" })
    })
    it("rejects malformed revisions and oversized payloads without exposing content in errors", async () => {
        const first = store(), session = createDraftSession()
        for (const revision of ["-1", "01", "1e3", "18446744073709551616"]) expect(await first.saveDraft(scope, revision, payload, session)).toEqual({ status: "invalid" })
        expect(isNotesRevision("18446744073709551615")).toBe(true)
        expect(await first.saveDraft(scope, "0", { ...payload, body: "😀".repeat(32769) }, session)).toEqual({ status: "invalid" })
    })
})

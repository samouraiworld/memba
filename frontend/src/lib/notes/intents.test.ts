import { afterEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import { createDraftSession, createNotesStore, notesKey, notesPartitionKey, notesRead, notesWrite, type NotesStore } from "./drafts"
import { createNotesIntents, reconcileNotesIntent, type NotesIntent, type NotesIntentInput, type NotesOperationEvidence } from "./intents"

const scope = { chainId: "gnoland-1", realm: "gno.land/r/example/notes", owner: "alice", noteId: "ab".repeat(16) }
const input: NotesIntentInput = { scope, operationId: "cd".repeat(16), requestDigest: "ab".repeat(32), actor: "alice", action: "Commit", expectedStateRevision: "9007199254740993", resultingStateRevision: "9007199254740994", expectedEpoch: "1", ownerGeneration: "1", draftLocalRevision: "7" }
const evidence: NotesOperationEvidence = { scope, operationId: input.operationId, actor: "alice", stateRevision: input.resultingStateRevision, height: "9007199254740995", outcome: "applied" }
const stores: NotesStore[] = []
function setup(factory = new IDBFactory()) { const store = createNotesStore({ indexedDB: factory }); stores.push(store); return { store, intents: createNotesIntents(store), session: createDraftSession() } }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe("durable Notes transaction intentions", () => {
    it("persists unknown across reload and refuses to reuse the same operation ID", async () => {
        const factory = new IDBFactory(), first = setup(factory)
        expect((await first.intents.begin(input, first.session)).status).toBe("saved")
        expect((await first.intents.settle(scope, input.operationId, "unknown", first.session)).status).toBe("saved")
        await first.store.close()
        const second = setup(factory)
        expect(await second.intents.get(scope, input.operationId)).toMatchObject({ phase: "unknown", expectedStateRevision: input.expectedStateRevision, requestDigest: input.requestDigest })
        expect(await second.intents.begin(input, second.session)).toEqual({ status: "conflict" })
        expect(await second.intents.settle(scope, input.operationId, "not-sent", second.session)).toEqual({ status: "conflict" })
    })
    it("requires a committed receipt before caller may open a wallet", async () => {
        const { intents, session } = setup()
        const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError") })
        expect(await intents.begin(input, session)).toEqual({ status: "unavailable" }); add.mockRestore()
        expect(await intents.get(scope, input.operationId)).toBeNull()
    })
    it("does not confirm a submitted hash, another operation, or a later mutation", async () => {
        const { intents, session } = setup()
        await intents.begin(input, session); await intents.settle(scope, input.operationId, "submitted", session, "EF".repeat(32))
        for (const patch of [{ operationId: "aa".repeat(16) }, { actor: "bob" }, { stateRevision: "9007199254740995" }, { height: "0" }, { scope: { ...scope, chainId: "onyx-1" } }]) expect(await intents.confirm(scope, input.operationId, { ...evidence, ...patch }, session)).toEqual({ status: "conflict" })
        expect((await intents.get(scope, input.operationId))?.phase).toBe("submitted")
        // A verified last-operation state observation needs no tx hash.
        expect((await intents.confirm(scope, input.operationId, evidence, session)).status).toBe("saved")
        expect((await intents.get(scope, input.operationId))?.phase).toBe("confirmed")
    })
    it("never clears drafts or receipts on confirmation and signals only the exact draft revision", async () => {
        const { store, intents, session } = setup()
        await store.saveDraft(scope, "0", { kind: "public", title: "", body: "new local text" }, session)
        const result = await intents.begin(input, session); expect(result.status).toBe("saved")
        const intent = (await intents.get(scope, input.operationId)) as NotesIntent
        expect(reconcileNotesIntent(intent, evidence, "7")).toEqual({ status: "confirmed", draftRevisionToClear: "7" })
        expect(reconcileNotesIntent(intent, evidence, "8")).toEqual({ status: "confirmed" })
        await intents.confirm(scope, input.operationId, evidence, session)
        expect(await store.getDraft(scope)).not.toBeNull(); expect(await intents.list(scope)).toHaveLength(1)
    })
    it("preserves an old unknown while allowing a distinct intention from a newer reviewed state", async () => {
        const { intents, session } = setup()
        await intents.begin(input, session); await intents.settle(scope, input.operationId, "unknown", session)
        for (const expectedStateRevision of [input.expectedStateRevision, "9007199254740992"]) {
            expect(await intents.begin({ ...input, operationId: "aa".repeat(16), expectedStateRevision }, session)).toEqual({ status: "conflict" })
        }
        expect((await intents.begin({ ...input, operationId: "aa".repeat(16), expectedStateRevision: "9007199254740996", resultingStateRevision: "9007199254740997" }, session)).status).toBe("saved")
        expect((await intents.get(scope, input.operationId))?.phase).toBe("unknown")
    })
    it("atomically admits one operation per base across independent tabs, including creation zero", async () => {
        const factory = new IDBFactory(), first = setup(factory), second = setup(factory)
        const create = { ...input, expectedStateRevision: "0", resultingStateRevision: "1" }
        const results = await Promise.all([
            first.intents.begin(create, first.session),
            second.intents.begin({ ...create, operationId: "ee".repeat(16) }, second.session),
        ])
        expect(results.map(result => result.status).sort()).toEqual(["conflict", "saved"])
        expect(await first.intents.list(scope)).toHaveLength(1)
        // A different note owns an independent lock namespace.
        expect((await second.intents.begin({ ...create, scope: { ...scope, noteId: "ee".repeat(16) } }, second.session)).status).toBe("saved")
    })
    it("refuses wrong hashes and imprecise or noncanonical numeric revisions", async () => {
        const { intents, session } = setup()
        expect(await intents.begin({ ...input, resultingStateRevision: "01" }, session)).toEqual({ status: "invalid" })
        await intents.begin(input, session); await intents.settle(scope, input.operationId, "submitted", session, "aa".repeat(32))
        expect(await intents.confirm(scope, input.operationId, { ...evidence, txHash: "bb".repeat(32) }, session)).toEqual({ status: "conflict" })
        expect(await intents.settle(scope, input.operationId, "unknown", session, "bad")).toEqual({ status: "invalid" })
    })
    it("requires an exact digest and snapshots it before persisting the reviewed request", async () => {
        const { intents, session } = setup()
        for (const requestDigest of [undefined, "", "aa".repeat(31), "AA".repeat(32), "gg".repeat(32)]) {
            expect(await intents.begin({ ...input, requestDigest } as NotesIntentInput, session)).toEqual({ status: "invalid" })
        }
        const mutable = { ...input }
        const pending = intents.begin(mutable, session.capture())
        mutable.requestDigest = "cd".repeat(32)
        expect((await pending).status).toBe("saved")
        expect((await intents.get(scope, input.operationId))?.requestDigest).toBe(input.requestDigest)
    })
    it("refuses stale captured session guards for begin and settlement", async () => {
        const { intents, session } = setup()
        const guard = session.capture()
        session.invalidate()
        expect(await intents.begin(input, guard)).toEqual({ status: "session-changed" })
        expect((await intents.begin(input, session.capture())).status).toBe("saved")
        expect(await intents.settle(scope, input.operationId, "unknown", guard)).toEqual({ status: "session-changed" })
        expect((await intents.get(scope, input.operationId))?.phase).toBe("prepared")
    })
    it("preserves but refuses an old malformed receipt without a digest", async () => {
        const { store, intents, session } = setup()
        const legacy: Partial<NotesIntentInput> = { ...input }
        delete legacy.requestDigest
        const key = JSON.stringify([notesKey(scope), input.operationId])
        await notesWrite(store.database, ["intents"], session.signal, (tx, finish) => {
            tx.objectStore("intents").add({ ...legacy, key, partition: notesPartitionKey(scope), schema: 1, phase: "unknown", createdAt: 1, updatedAt: 1 })
            finish({ status: "saved", value: null })
        })
        await expect(intents.get(scope, input.operationId)).rejects.toThrow("stored copy was kept")
        expect(await notesRead(store.database, "intents", records => records.get(key))).toHaveProperty("phase", "unknown")
        expect(await intents.begin(input, session)).toEqual({ status: "conflict" })
    })
})

const notesRealm = "gno.land/r/samcrew/memba_notes_v1", digest = "ab".repeat(32)
const descriptors: { name: string; fixture: NotesIntentInput }[] = [
    { name: "identity", fixture: { ...input, scope: { ...scope, realm: "gno.land/r/samcrew/enckeys_v1" }, action: "identity-setup",
        expectedStateRevision: "1", resultingStateRevision: "2", expectedEpoch: "2", ownerGeneration: "1", draftLocalRevision: "0",
        verification: { kind: "identity-v1", mode: "standard", generation: "2", backupRevision: "3", publicKeySha256: digest, backupSha256: digest, quoteHeight: "10" } } },
    { name: "access", fixture: { ...input, scope: { ...scope, realm: notesRealm }, action: "access-addWriter",
        expectedStateRevision: "7", resultingStateRevision: "8", expectedEpoch: "3", ownerGeneration: "1", draftLocalRevision: "0",
        verification: { kind: "access-v1", metadataSha256: digest, writersSha256: digest, quoteHeight: "10" } } },
    { name: "private-comment", fixture: { ...input, scope: { ...scope, realm: `${notesRealm}/comments/${"ef".repeat(16)}` }, action: "addPrivateComment",
        expectedStateRevision: "7", resultingStateRevision: "8", expectedEpoch: "3", ownerGeneration: "1", draftLocalRevision: "1",
        verification: { kind: "private-comment-v1", noteId: "ef".repeat(16), parent: "", author: scope.owner, bodyRevision: "1", epoch: "3",
            ciphertextSha256: digest, deleted: false, hidden: false, resolved: false, quoteHeight: "10" } } },
]
const rawReceipts = (store: NotesStore) => notesRead<unknown[]>(store.database, "intents", records => records.getAll())

// Exercise the persisted receipt API directly, without future signing adapters.
describe("F02 durable verification descriptors", () => {
    it.each(descriptors)("persists $name, snapshots inputs and reloads unknown exactly", async ({ fixture }) => {
        const factory = new IDBFactory(), first = setup(factory)
        const candidate = structuredClone(fixture), expected = structuredClone(fixture.verification)
        const pending = first.intents.begin(candidate, first.session)
        candidate.verification!.quoteHeight = "999"
        expect(await pending).toMatchObject({ status: "saved", value: { verification: expected } })
        expect(await first.intents.settle(fixture.scope, fixture.operationId, "unknown", first.session)).toMatchObject({ status: "saved" })
        await first.store.close()
        const second = setup(factory)
        expect(await second.intents.get(fixture.scope, fixture.operationId)).toMatchObject({ phase: "unknown", verification: expected })
        expect((await rawReceipts(second.store))[0]).toMatchObject({ verification: expected })
        expect(await second.intents.begin(fixture, second.session)).toEqual({ status: "conflict" })
        expect(await second.intents.settle(fixture.scope, fixture.operationId, "not-sent", second.session)).toEqual({ status: "conflict" })
    })

    it.each(descriptors)("rejects malformed $name without changing durable receipts", async ({ fixture }) => {
        const { intents, store, session } = setup()
        await intents.begin(input, session)
        await intents.settle(scope, input.operationId, "unknown", session)
        const before = await rawReceipts(store)
        const changeProof = (patch: Record<string, unknown>): NotesIntentInput => ({ ...fixture, verification: { ...fixture.verification!, ...patch } as NotesIntentInput["verification"] })
        const rejected: NotesIntentInput[] = [
            { ...fixture, scope: { ...fixture.scope, realm: "gno.land/r/wrong/realm" } }, { ...fixture, action: "wrongAction" },
            { ...fixture, expectedEpoch: "01" }, { ...fixture, resultingStateRevision: String(BigInt(fixture.expectedStateRevision) + 2n) },
            changeProof({ secret: "must never persist" }), changeProof({ quoteHeight: "0" }), changeProof({ quoteHeight: "9223372036854775808" }),
        ]
        if (fixture.verification?.kind === "identity-v1") rejected.push(
            { ...fixture, ownerGeneration: "2" }, { ...fixture, expectedEpoch: "3" }, changeProof({ generation: "3" }), changeProof({ publicKeySha256: digest.toUpperCase() }),
        )
        if (fixture.verification?.kind === "access-v1") rejected.push(
            { ...fixture, expectedStateRevision: "0", resultingStateRevision: "1" }, { ...fixture, ownerGeneration: "0" }, { ...fixture, draftLocalRevision: "1" }, changeProof({ writersSha256: digest.toUpperCase() }),
        )
        if (fixture.verification?.kind === "private-comment-v1") rejected.push(
            { ...fixture, expectedEpoch: "4" }, { ...changeProof({ epoch: "0" }), expectedEpoch: "0" }, changeProof({ ciphertextSha256: digest.toUpperCase() }),
            ...["bodySha256", "anchorSha256", "plaintext"].map(field => changeProof({ [field]: digest })),
        )
        for (const candidate of rejected) {
            expect(await intents.begin(candidate, session)).toEqual({ status: "invalid" })
            expect(await rawReceipts(store)).toEqual(before)
        }
    })

    it.each(descriptors)("never reports saved for $name when commit aborts after add succeeds", async ({ fixture }) => {
        const { store, intents, session } = setup(), before = await rawReceipts(store)
        const original = IDBObjectStore.prototype.add
        const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = original.apply(this, args)
            request.addEventListener("success", () => this.transaction.abort())
            return request
        })
        expect(await intents.begin(fixture, session)).toEqual({ status: "unavailable" })
        add.mockRestore()
        expect(await rawReceipts(store)).toEqual(before)
        expect(await intents.get(fixture.scope, fixture.operationId)).toBeNull()
        expect(await intents.begin(fixture, session)).toMatchObject({ status: "saved" })
    })

    it.each([false, true])("reloads public receipts with explicit owner=%s and rejects ambiguous extras", async explicitOwner => {
        const factory = new IDBFactory(), first = setup(factory)
        const fixture: NotesIntentInput = { ...input, action: "commit", expectedStateRevision: "1", resultingStateRevision: "2", expectedEpoch: "0",
            verification: { kind: "public-v1", mode: 3, epoch: "0", titleSha256: digest, bodySha256: digest, deleted: false,
                quoteHeight: "10", ownerGeneration: "1", titleRevision: "1", bodyRevision: "2", ...(explicitOwner ? { owner: "note-owner" } : {}) } }
        expect(await first.intents.begin(fixture, first.session)).toMatchObject({ status: "saved" })
        await first.store.close()
        const second = setup(factory)
        expect((await second.intents.get(fixture.scope, fixture.operationId))?.verification).toEqual(fixture.verification)
        const before = await rawReceipts(second.store)
        for (const patch of [{ owner: "" }, { owner: undefined }, { owner: "a".repeat(129) }, { secret: "must never persist" }]) {
            const candidate = { ...fixture, verification: { ...fixture.verification!, ...patch } as NotesIntentInput["verification"] }
            expect(await second.intents.begin(candidate, second.session)).toEqual({ status: "invalid" })
            expect(await rawReceipts(second.store)).toEqual(before)
        }
    })
})

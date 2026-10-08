import { afterEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import { createDraftSession, createNotesStore, type NotesStore } from "./drafts"
import { createNotesIntents, reconcileNotesIntent, type NotesIntent, type NotesIntentInput, type NotesOperationEvidence } from "./intents"

const scope = { chainId: "gnoland-1", realm: "gno.land/r/example/notes", owner: "alice", noteId: "ab".repeat(16) }
const input: NotesIntentInput = { scope, operationId: "cd".repeat(16), actor: "alice", action: "Commit", expectedStateRevision: "9007199254740993", resultingStateRevision: "9007199254740994", expectedEpoch: "1", ownerGeneration: "1", draftLocalRevision: "7" }
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
        expect(await second.intents.get(scope, input.operationId)).toMatchObject({ phase: "unknown", expectedStateRevision: input.expectedStateRevision })
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
        expect((await intents.begin({ ...input, operationId: "aa".repeat(16), expectedStateRevision: "9007199254740996", resultingStateRevision: "9007199254740997" }, session)).status).toBe("saved")
        expect((await intents.get(scope, input.operationId))?.phase).toBe("unknown")
    })
    it("refuses wrong hashes and imprecise or noncanonical numeric revisions", async () => {
        const { intents, session } = setup()
        expect(await intents.begin({ ...input, resultingStateRevision: "01" }, session)).toEqual({ status: "invalid" })
        await intents.begin(input, session); await intents.settle(scope, input.operationId, "submitted", session, "aa".repeat(32))
        expect(await intents.confirm(scope, input.operationId, { ...evidence, txHash: "bb".repeat(32) }, session)).toEqual({ status: "conflict" })
        expect(await intents.settle(scope, input.operationId, "unknown", session, "bad")).toEqual({ status: "invalid" })
    })
})

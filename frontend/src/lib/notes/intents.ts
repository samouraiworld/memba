/** Durable signing intentions. Unknown is preserved until matching evidence exists. */
import { isNotesRevision, notesKey, notesPartitionKey, notesRead, notesRequest, notesWrite, validNotesPartition, validNotesScope, type DraftSession, type NotesPartition, type NotesScope, type NotesStore, type NotesWriteResult } from "./drafts"

export interface NotesIntentInput {
    scope: NotesScope
    operationId: string
    actor: string
    action: string
    expectedStateRevision: string
    resultingStateRevision: string
    expectedEpoch: string
    ownerGeneration: string
    draftLocalRevision: string
}
export type NotesIntentPhase = "prepared" | "submitted" | "unknown" | "confirmed" | "failed" | "not-sent"
export interface NotesIntent extends NotesIntentInput { schema: 1; phase: NotesIntentPhase; txHash?: string; createdAt: number; updatedAt: number }
/** Normalized, verified observation; this is not an assumption about a realm getter API. */
export interface NotesOperationEvidence {
    scope: NotesScope
    operationId: string
    actor: string
    stateRevision: string
    height: string
    outcome: "applied" | "failed"
    txHash?: string
}
export interface IntentReconciliation { status: "confirmed" | "failed" | "unknown"; draftRevisionToClear?: string }
const HEX_ID = /^[a-f0-9]{32}$/
const TX_HASH = /^[a-fA-F0-9]{64}$/
const phases: readonly NotesIntentPhase[] = ["prepared", "submitted", "unknown", "confirmed", "failed", "not-sent"]
const key = (scope: NotesScope, operationId: string) => JSON.stringify([notesKey(scope), operationId])
function validInput(value: NotesIntentInput): boolean {
    return !!value.scope && validNotesScope(value.scope) && value.scope.owner !== "guest" && HEX_ID.test(value.operationId)
        && typeof value.actor === "string" && value.actor === value.scope.owner && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.action)
        && [value.expectedStateRevision, value.resultingStateRevision, value.expectedEpoch, value.ownerGeneration, value.draftLocalRevision].every(isNotesRevision)
}
function validIntent(value: unknown): value is NotesIntent {
    if (!value || typeof value !== "object") return false
    const intent = value as NotesIntent
    return intent.schema === 1 && validInput(intent) && phases.includes(intent.phase) && (intent.txHash === undefined || TX_HASH.test(intent.txHash))
        && Number.isSafeInteger(intent.createdAt) && intent.createdAt >= 0 && Number.isSafeInteger(intent.updatedAt) && intent.updatedAt >= intent.createdAt
}
function record(value: NotesIntent): NotesIntent {
    return {
        schema: 1, scope: { chainId: value.scope.chainId, realm: value.scope.realm, owner: value.scope.owner, noteId: value.scope.noteId }, operationId: value.operationId, actor: value.actor, action: value.action,
        expectedStateRevision: value.expectedStateRevision, resultingStateRevision: value.resultingStateRevision,
        expectedEpoch: value.expectedEpoch, ownerGeneration: value.ownerGeneration, draftLocalRevision: value.draftLocalRevision,
        phase: value.phase, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.txHash ? { txHash: value.txHash } : {}),
    }
}
/** A later last-operation observation confirms nothing about this intention. */
export function reconcileNotesIntent(intent: NotesIntent, evidence: NotesOperationEvidence | null, currentDraftRevision?: string): IntentReconciliation {
    if (!validIntent(intent) || !evidence || !validNotesScope(evidence.scope) || notesKey(intent.scope) !== notesKey(evidence.scope)
        || evidence.operationId !== intent.operationId || evidence.actor !== intent.actor
        || !isNotesRevision(evidence.stateRevision) || evidence.stateRevision !== intent.resultingStateRevision
        || !isNotesRevision(evidence.height) || evidence.height === "0"
        || (evidence.txHash !== undefined && !TX_HASH.test(evidence.txHash))
        || (intent.txHash && evidence.txHash && intent.txHash.toUpperCase() !== evidence.txHash.toUpperCase())) return { status: "unknown" }
    if (evidence.outcome === "failed") return { status: "failed" }
    if (evidence.outcome !== "applied") return { status: "unknown" }
    return { status: "confirmed", ...(currentDraftRevision === intent.draftLocalRevision ? { draftRevisionToClear: intent.draftLocalRevision } : {}) }
}

export class NotesIntents {
    constructor(private store: NotesStore) {}
    async get(scope: NotesScope, operationId: string): Promise<NotesIntent | null> {
        if (!validNotesScope(scope) || !HEX_ID.test(operationId)) throw new Error("Invalid transaction receipt location.")
        const value = await notesRead<unknown>(this.store.database, "intents", store => store.get(key(scope, operationId)))
        if (value === undefined) return null
        if (!validIntent(value) || notesKey(value.scope) !== notesKey(scope) || value.operationId !== operationId) throw new Error("This transaction receipt could not be read. Its stored copy was kept.")
        return record(value)
    }
    async list(partition: NotesPartition): Promise<NotesIntent[]> {
        if (!validNotesPartition(partition)) throw new Error("Invalid transaction receipt location.")
        const values = await notesRead<unknown[]>(this.store.database, "intents", store => store.index("partition").getAll(notesPartitionKey(partition)))
        if (values.some(value => !validIntent(value) || notesPartitionKey(value.scope) !== notesPartitionKey(partition))) throw new Error("Some transaction receipts could not be read. Their stored copies were kept.")
        return (values as NotesIntent[]).map(record).sort((a, b) => b.createdAt - a.createdAt)
    }
    /** Await a saved result before opening a wallet. Reusing any operation ID is refused. */
    begin(input: NotesIntentInput, session: DraftSession): Promise<NotesWriteResult<NotesIntent>> {
        if (!validInput(input)) return Promise.resolve({ status: "invalid" })
        const now = Date.now()
        const next = record({ ...input, schema: 1, phase: "prepared", createdAt: now, updatedAt: now })
        return notesWrite(this.store.database, ["intents"], session.signal, (tx, finish) => {
            const store = tx.objectStore("intents")
            notesRequest(store.get(key(next.scope, next.operationId)), tx, (value: unknown) => {
                if (value !== undefined) { finish({ status: "conflict" }); return }
                store.add({ ...next, key: key(next.scope, next.operationId), partition: notesPartitionKey(next.scope) })
                finish({ status: "saved", value: next })
            })
        })
    }
    /** "not-sent" is only for a driver outcome that establishes nothing was sent. */
    settle(scope: NotesScope, operationId: string, phase: "submitted" | "unknown" | "not-sent", session: DraftSession, txHash?: string): Promise<NotesWriteResult<NotesIntent>> {
        if (!["submitted", "unknown", "not-sent"].includes(phase) || (txHash !== undefined && !TX_HASH.test(txHash))) return Promise.resolve({ status: "invalid" })
        return this.update(scope, operationId, session, current => {
            if (current.txHash && txHash && current.txHash.toUpperCase() !== txHash.toUpperCase()) return null
            if (["confirmed", "failed", "not-sent"].includes(current.phase)) return null
            if (current.phase === "unknown" && phase !== "unknown") return null
            if (current.phase === "submitted" && phase === "not-sent") return null
            return { ...current, phase, ...(txHash ? { txHash: txHash.toUpperCase() } : {}) }
        })
    }
    /** Does not delete a draft or receipt. The caller may separately CAS-delete that exact draft. */
    confirm(scope: NotesScope, operationId: string, evidence: NotesOperationEvidence, session: DraftSession): Promise<NotesWriteResult<NotesIntent>> {
        const observation = structuredClone(evidence)
        return this.update(scope, operationId, session, current => {
            if (["not-sent", "confirmed", "failed"].includes(current.phase)) return null
            const result = reconcileNotesIntent(current, observation)
            return result.status === "unknown" ? null : { ...current, phase: result.status }
        })
    }
    private update(scope: NotesScope, operationId: string, session: DraftSession, change: (intent: NotesIntent) => NotesIntent | null): Promise<NotesWriteResult<NotesIntent>> {
        if (!validNotesScope(scope) || !HEX_ID.test(operationId)) return Promise.resolve({ status: "invalid" })
        const storageKey = key(scope, operationId)
        return notesWrite(this.store.database, ["intents"], session.signal, (tx, finish) => {
            const store = tx.objectStore("intents")
            notesRequest(store.get(storageKey), tx, (value: unknown) => {
                if (!validIntent(value)) { finish({ status: "invalid" }); return }
                const changed = change(record(value))
                if (!changed) { finish({ status: "conflict" }); return }
                const next = { ...changed, updatedAt: Math.max(Date.now(), changed.updatedAt) }
                store.put({ ...next, key: storageKey, partition: notesPartitionKey(next.scope) })
                finish({ status: "saved", value: next })
            })
        })
    }
}
export function createNotesIntents(store: NotesStore): NotesIntents { return new NotesIntents(store) }

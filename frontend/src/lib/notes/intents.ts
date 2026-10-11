/** Durable signing intentions. Unknown is preserved until matching evidence exists. */
import { isNotesRevision, notesKey, notesPartitionKey, notesRead, notesRequest, notesWrite, validNotesPartition, validNotesScope, type DraftWriteGuard, type NotesPartition, type NotesScope, type NotesStore, type NotesWriteResult } from "./drafts"

/** Hashes describe PUBLIC bytes only; never attach this to encrypted or identity operations. */
export interface PublicIntentVerification {
    /** Absent only on legacy owner-authored receipts. */
    owner?: string
    /** Present only for an explicit owner change to collective content permission. */
    allowPublicWrites?: boolean
    kind: "public-v1"
    mode: 3 | 4
    epoch: string
    titleSha256: string
    bodySha256: string
    deleted: boolean
    quoteHeight: string
    ownerGeneration: string
    titleRevision: string
    bodyRevision: string
}
export interface CommentIntentVerification {
    kind: "comment-v1"
    noteId: string
    parent: string
    author: string
    bodyRevision: string
    epoch: string
    anchorSha256: string
    bodySha256: string
    deleted: boolean
    hidden: boolean
    resolved: boolean
    quoteHeight: string
}
/** Private comment proof stores ciphertext hashes only, never a plaintext fingerprint. */
export interface PrivateCommentIntentVerification extends Omit<CommentIntentVerification, "kind" | "anchorSha256" | "bodySha256"> {
    kind: "private-comment-v1"
    ciphertextSha256: string
}
/** Ciphertext/public metadata only. Publish is checked by reconstructing the exact public MsgCall. */
export interface PrivateIntentVerification {
    kind: "private-v1"
    mode: 0 | 1 | 2 | 3 | 4
    epoch: string
    owner: string
    pendingOwner: string
    ownerGeneration: string
    titleRevision: string
    bodyRevision: string
    titleBlobSha256: string
    bodyBlobSha256: string
    commitmentSha256: string
    manifestSha256: string
    revealedEpoch: string
    revealedCommitment: string
    quoteHeight: string
    maxDepositUgnot: string
}
/** Public registry/backup commitments only; no seed, recovery phrase or wallet signature. */
export interface IdentityIntentVerification {
    kind: "identity-v1"
    mode: "standard" | "vault"
    generation: string
    backupRevision: string
    publicKeySha256: string
    backupSha256: string
    quoteHeight: string
}
/** Public metadata commitments for ACL and two-phase ownership changes. */
export interface AccessIntentVerification { kind: "access-v1"; metadataSha256: string; writersSha256: string; quoteHeight: string }
export function validAccessVerification(value: unknown): value is AccessIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as AccessIntentVerification
    return Object.keys(v).length === 4 && Object.keys(v).every(k => ["kind", "metadataSha256", "writersSha256", "quoteHeight"].includes(k))
        && v.kind === "access-v1" && typeof v.metadataSha256 === "string" && typeof v.writersSha256 === "string"
        && /^[a-f0-9]{64}$/.test(v.metadataSha256) && /^[a-f0-9]{64}$/.test(v.writersSha256)
        && isNotesRevision(v.quoteHeight) && v.quoteHeight !== "0" && BigInt(v.quoteHeight) <= 0x7fffffffffffffffn
}
export interface NotesIntentInput {
    scope: NotesScope
    operationId: string
    /** SHA-256 of the exact canonical request reviewed before opening the wallet. */
    requestDigest: string
    actor: string
    action: string
    expectedStateRevision: string
    resultingStateRevision: string
    expectedEpoch: string
    ownerGeneration: string
    draftLocalRevision: string
    verification?: AccessIntentVerification | PublicIntentVerification | CommentIntentVerification | PrivateCommentIntentVerification | PrivateIntentVerification | IdentityIntentVerification
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
const HASH = /^[a-f0-9]{64}$/
const VERIFICATION_KEYS = ["kind", "mode", "epoch", "titleSha256", "bodySha256", "deleted", "quoteHeight", "ownerGeneration", "titleRevision", "bodyRevision"]
export function validPublicVerification(value: unknown): value is PublicIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as PublicIntentVerification
    return Object.keys(v).length === VERIFICATION_KEYS.length + (Object.hasOwn(v, "owner") ? 1 : 0) + (Object.hasOwn(v, "allowPublicWrites") ? 1 : 0)
        && Object.keys(v).every(key => VERIFICATION_KEYS.includes(key) || key === "owner" || key === "allowPublicWrites")
        && (!Object.hasOwn(v, "owner") || (typeof v.owner === "string" && v.owner.length > 0 && v.owner.length <= 128))
        && (!Object.hasOwn(v, "allowPublicWrites") || (typeof v.allowPublicWrites === "boolean" && v.mode === 4 && v.deleted === false && typeof v.owner === "string" && v.owner.length > 0))
        && v.kind === "public-v1" && (v.mode === 3 || v.mode === 4) && typeof v.deleted === "boolean"
        && typeof v.titleSha256 === "string" && HASH.test(v.titleSha256) && typeof v.bodySha256 === "string" && HASH.test(v.bodySha256)
        && [v.epoch, v.quoteHeight, v.ownerGeneration, v.titleRevision, v.bodyRevision].every(isNotesRevision)
        && BigInt(v.epoch) <= 0xffffffffn && BigInt(v.quoteHeight) > 0n && BigInt(v.quoteHeight) <= 0x7fffffffffffffffn
        && v.ownerGeneration !== "0" && v.titleRevision !== "0" && v.bodyRevision !== "0"
}
const COMMENT_KEYS = ["kind", "noteId", "parent", "author", "bodyRevision", "epoch", "anchorSha256", "bodySha256", "deleted", "hidden", "resolved", "quoteHeight"]
export function validCommentVerification(value: unknown): value is CommentIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as CommentIntentVerification
    return Object.keys(v).length === COMMENT_KEYS.length && Object.keys(v).every(key => COMMENT_KEYS.includes(key))
        && v.kind === "comment-v1" && typeof v.noteId === "string" && HEX_ID.test(v.noteId) && !/^0+$/.test(v.noteId)
        && typeof v.parent === "string" && (v.parent === "" || (HEX_ID.test(v.parent) && !/^0+$/.test(v.parent)))
        && typeof v.author === "string" && v.author.length > 0 && v.author.length <= 128
        && typeof v.anchorSha256 === "string" && HASH.test(v.anchorSha256) && typeof v.bodySha256 === "string" && HASH.test(v.bodySha256)
        && [v.deleted, v.hidden, v.resolved].every(flag => typeof flag === "boolean")
        && [v.epoch, v.bodyRevision, v.quoteHeight].every(isNotesRevision) && v.bodyRevision !== "0"
        && BigInt(v.epoch) <= 0xffffffffn && BigInt(v.quoteHeight) > 0n && BigInt(v.quoteHeight) <= 0x7fffffffffffffffn
}
const PRIVATE_COMMENT_KEYS = ["kind", "noteId", "parent", "author", "bodyRevision", "epoch", "ciphertextSha256", "deleted", "hidden", "resolved", "quoteHeight"]
export function validPrivateCommentVerification(value: unknown): value is PrivateCommentIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as PrivateCommentIntentVerification
    if (Object.keys(v).length !== PRIVATE_COMMENT_KEYS.length || !Object.keys(v).every(key => PRIVATE_COMMENT_KEYS.includes(key)) || v.kind !== "private-comment-v1") return false
    const { ciphertextSha256, ...metadata } = v
    return validCommentVerification({ ...metadata, kind: "comment-v1", anchorSha256: "0".repeat(64), bodySha256: ciphertextSha256 }) && v.epoch !== "0"
}
const phases: readonly NotesIntentPhase[] = ["prepared", "submitted", "unknown", "confirmed", "failed", "not-sent"]
const PRIVATE_KEYS = ["kind", "mode", "epoch", "owner", "pendingOwner", "ownerGeneration", "titleRevision", "bodyRevision", "titleBlobSha256", "bodyBlobSha256", "commitmentSha256", "manifestSha256", "revealedEpoch", "revealedCommitment", "quoteHeight", "maxDepositUgnot"]
export function validPrivateVerification(value: unknown): value is PrivateIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as PrivateIntentVerification, hash = (s: unknown) => typeof s === "string" && HASH.test(s)
    return Object.keys(v).length === PRIVATE_KEYS.length && Object.keys(v).every(key => PRIVATE_KEYS.includes(key))
        && v.kind === "private-v1" && Number.isInteger(v.mode) && v.mode >= 0 && v.mode <= 4
        && typeof v.owner === "string" && v.owner.length > 0 && v.owner.length <= 128 && typeof v.pendingOwner === "string" && v.pendingOwner.length <= 128
        && (v.mode <= 2 ? hash(v.titleBlobSha256) && hash(v.bodyBlobSha256) : (v.titleBlobSha256 === "" && v.bodyBlobSha256 === "") || (hash(v.titleBlobSha256) && hash(v.bodyBlobSha256)))
        && hash(v.commitmentSha256) && (v.manifestSha256 === "" || hash(v.manifestSha256))
        && (v.revealedEpoch === "0" ? v.revealedCommitment === "" : hash(v.revealedCommitment))
        && [v.epoch, v.ownerGeneration, v.titleRevision, v.bodyRevision, v.revealedEpoch, v.quoteHeight, v.maxDepositUgnot].every(isNotesRevision)
        && BigInt(v.epoch) > 0n && BigInt(v.epoch) <= 0xffffffffn && BigInt(v.revealedEpoch) <= BigInt(v.epoch)
        && BigInt(v.quoteHeight) > 0n && BigInt(v.quoteHeight) <= 0x7fffffffffffffffn && BigInt(v.maxDepositUgnot) <= 0x7fffffffffffffffn
        && v.ownerGeneration !== "0" && v.titleRevision !== "0" && v.bodyRevision !== "0"
}
const IDENTITY_KEYS = ["kind", "mode", "generation", "backupRevision", "publicKeySha256", "backupSha256", "quoteHeight"]
export function validIdentityVerification(value: unknown): value is IdentityIntentVerification {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const v = value as IdentityIntentVerification
    return Object.keys(v).length === IDENTITY_KEYS.length && Object.keys(v).every(key => IDENTITY_KEYS.includes(key))
        && v.kind === "identity-v1" && (v.mode === "standard" || v.mode === "vault")
        && typeof v.publicKeySha256 === "string" && HASH.test(v.publicKeySha256)
        && typeof v.backupSha256 === "string" && HASH.test(v.backupSha256)
        && [v.generation, v.backupRevision, v.quoteHeight].every(isNotesRevision)
        && v.generation !== "0" && v.backupRevision !== "0" && v.quoteHeight !== "0" && BigInt(v.quoteHeight) <= 0x7fffffffffffffffn
}
const key = (scope: NotesScope, operationId: string) => JSON.stringify([notesKey(scope), operationId])
function validInput(value: NotesIntentInput): boolean {
    return !!value.scope && validNotesScope(value.scope) && value.scope.owner !== "guest" && HEX_ID.test(value.operationId)
        && typeof value.requestDigest === "string" && /^[a-f0-9]{64}$/.test(value.requestDigest)
        && typeof value.actor === "string" && value.actor === value.scope.owner && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.action)
        && [value.expectedStateRevision, value.resultingStateRevision, value.expectedEpoch, value.ownerGeneration, value.draftLocalRevision].every(isNotesRevision)
        && (value.verification === undefined || (validPublicVerification(value.verification)
            && ["create", "commit", "rename", "delete", "comments", "public-writes"].includes(value.action)
            && (value.action === "public-writes") === Object.hasOwn(value.verification, "allowPublicWrites")
            && value.verification.deleted === (value.action === "delete") && value.verification.epoch === value.expectedEpoch
            && value.verification.ownerGeneration === value.ownerGeneration
            && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n
            && BigInt(value.verification.titleRevision) <= BigInt(value.resultingStateRevision)
            && BigInt(value.verification.bodyRevision) <= BigInt(value.resultingStateRevision))
            || (validCommentVerification(value.verification)
                && ["addComment", "deleteComment", "resolveComment", "hideComment"].includes(value.action)
                && value.scope.realm === `gno.land/r/samcrew/memba_notes_v1/comments/${value.verification.noteId}`
                && value.verification.epoch === value.expectedEpoch
                && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n)
            || (validPrivateCommentVerification(value.verification)
                && ["addPrivateComment", "deletePrivateComment", "resolvePrivateComment", "hidePrivateComment"].includes(value.action)
                && value.scope.realm === `gno.land/r/samcrew/memba_notes_v1/comments/${value.verification.noteId}`
                && value.verification.epoch === value.expectedEpoch
                && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n)
            || (validPrivateVerification(value.verification)
                && value.scope.realm === "gno.land/r/samcrew/memba_notes_v1"
                && ["private-create", "private-commit", "private-rotate", "private-access", "private-refresh", "private-reveal", "private-publish"].includes(value.action)
                && value.verification.ownerGeneration === value.ownerGeneration
                && (value.action === "private-publish" ? value.verification.mode >= 3 && value.verification.titleBlobSha256 === "" && value.verification.bodyBlobSha256 === "" : HASH.test(value.verification.titleBlobSha256) && HASH.test(value.verification.bodyBlobSha256) && (value.action === "private-reveal" || value.verification.mode <= 2))
                && (value.action === "private-reveal" ? value.verification.revealedEpoch !== "0" : value.verification.revealedEpoch === "0")
                && (!["private-create", "private-rotate", "private-access", "private-refresh", "private-commit"].includes(value.action) || HASH.test(value.verification.manifestSha256))
                && BigInt(value.verification.epoch) === BigInt(value.expectedEpoch) + (["private-create", "private-rotate"].includes(value.action) ? 1n : 0n)
                && (value.action !== "private-create" || (value.expectedStateRevision === "0" && value.expectedEpoch === "0"))
                && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n
                && BigInt(value.verification.titleRevision) <= BigInt(value.resultingStateRevision)
                && BigInt(value.verification.bodyRevision) <= BigInt(value.resultingStateRevision))
            || (validAccessVerification(value.verification)
                && value.scope.realm === "gno.land/r/samcrew/memba_notes_v1"
                && ["access-addWriter", "access-removeWriter", "access-proposeOwner", "access-cancelOwner", "access-acceptOwner", "access-delete"].includes(value.action)
                && value.expectedStateRevision !== "0" && value.ownerGeneration !== "0" && value.draftLocalRevision === "0"
                && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n)
            || (validIdentityVerification(value.verification)
                && value.action === "identity-setup" && value.scope.realm === "gno.land/r/samcrew/enckeys_v1"
                && value.ownerGeneration === value.expectedStateRevision
                && value.verification.generation === value.resultingStateRevision
                && BigInt(value.resultingStateRevision) === BigInt(value.expectedStateRevision) + 1n
                && BigInt(value.verification.backupRevision) === BigInt(value.expectedEpoch) + 1n))
}
function validIntent(value: unknown): value is NotesIntent {
    if (!value || typeof value !== "object") return false
    const intent = value as NotesIntent
    return intent.schema === 1 && validInput(intent) && phases.includes(intent.phase) && (intent.txHash === undefined || TX_HASH.test(intent.txHash))
        && Number.isSafeInteger(intent.createdAt) && intent.createdAt >= 0 && Number.isSafeInteger(intent.updatedAt) && intent.updatedAt >= intent.createdAt
}
function record(value: NotesIntent): NotesIntent {
    return {
        schema: 1, scope: { chainId: value.scope.chainId, realm: value.scope.realm, owner: value.scope.owner, noteId: value.scope.noteId }, operationId: value.operationId, requestDigest: value.requestDigest, actor: value.actor, action: value.action,
        expectedStateRevision: value.expectedStateRevision, resultingStateRevision: value.resultingStateRevision,
        expectedEpoch: value.expectedEpoch, ownerGeneration: value.ownerGeneration, draftLocalRevision: value.draftLocalRevision,
        ...(value.verification ? { verification: { ...value.verification } } : {}),
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
    /** Await commit before wallet. Pending note mutations require a strictly newer reviewed base. */
    begin(input: NotesIntentInput, session: DraftWriteGuard): Promise<NotesWriteResult<NotesIntent>> {
        if (!validInput(input)) return Promise.resolve({ status: "invalid" })
        const now = Date.now()
        const next = record({ ...input, schema: 1, phase: "prepared", createdAt: now, updatedAt: now })
        return notesWrite(this.store.database, ["intents"], session.signal, (tx, finish) => {
            const store = tx.objectStore("intents")
            notesRequest(store.get(key(next.scope, next.operationId)), tx, (value: unknown) => {
                if (value !== undefined) { finish({ status: "conflict" }); return }
                notesRequest(store.index("partition").getAll(notesPartitionKey(next.scope)), tx, (receipts: unknown[]) => {
                    if (receipts.some(receipt => !validIntent(receipt))) { finish({ status: "invalid" }); return }
                    const blocked = (receipts as NotesIntent[]).some(receipt => notesKey(receipt.scope) === notesKey(next.scope)
                        && ["prepared", "submitted", "unknown"].includes(receipt.phase)
                        && BigInt(receipt.expectedStateRevision) >= BigInt(next.expectedStateRevision))
                    if (blocked) { finish({ status: "conflict" }); return }
                    store.add({ ...next, key: key(next.scope, next.operationId), partition: notesPartitionKey(next.scope) })
                    finish({ status: "saved", value: next })
                })
            })
        })
    }
    /** "not-sent" is only for a driver outcome that establishes nothing was sent. */
    settle(scope: NotesScope, operationId: string, phase: "submitted" | "unknown" | "not-sent", session: DraftWriteGuard, txHash?: string): Promise<NotesWriteResult<NotesIntent>> {
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
    confirm(scope: NotesScope, operationId: string, evidence: NotesOperationEvidence, session: DraftWriteGuard): Promise<NotesWriteResult<NotesIntent>> {
        const observation = structuredClone(evidence)
        return this.update(scope, operationId, session, current => {
            if (["not-sent", "confirmed", "failed"].includes(current.phase)) return null
            const result = reconcileNotesIntent(current, observation)
            return result.status === "unknown" ? null : { ...current, phase: result.status }
        })
    }
    private update(scope: NotesScope, operationId: string, session: DraftWriteGuard, change: (intent: NotesIntent) => NotesIntent | null): Promise<NotesWriteResult<NotesIntent>> {
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

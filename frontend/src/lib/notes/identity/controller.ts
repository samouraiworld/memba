import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { DraftSession } from '../drafts'
import { identityFromSeed, verifiedIdentity } from '../crypto/identity'
import type { NotesIdentity } from '../crypto/identity'
import { parseBackup, recoverIdentity, sealBackup } from '../crypto/backup'
import type { BackupBinding, BackupMode } from '../crypto/backup'
import { requestNotesUnlock } from '../crypto/signer'
import { equalBytes, networkBytes, NotesCryptoError, randomBytes, requireBytes } from '../crypto/bytes'
import { readRecoveryFile, recoveryEntropy, recoveryFile, recoveryPhrase } from './recovery'

export interface IdentityChainState {
  generation: bigint; active: boolean; publicKey: Uint8Array; keyOperationId: string; keyHeight: bigint
  backup: { revision: bigint; record: Uint8Array; operationId: string; height: bigint } | null
}
export interface IdentityContext {
  chainId: string; realm: string; address: string; addressBytes: Uint8Array
  session: DraftSession; isCurrent: () => boolean; read: () => Promise<IdentityChainState>
}
export interface IdentitySetupPlan {
  operationId: string; expectedGeneration: bigint; expectedBackupRevision: bigint; generation: bigint
  mode: BackupMode; publicKey: Uint8Array; backup: Uint8Array; migrationPartial: boolean
}
export interface IdentitySnapshot {
  phase: 'unknown' | 'empty' | 'revoked' | 'locked' | 'unlocked' | 'prepared'; busy: boolean
  generation?: string; mode?: BackupMode; recoveryConfirmed: boolean; migrationPartial: boolean
}
interface Pending { plan: IdentitySetupPlan; seed: Uint8Array; recovery: Uint8Array; confirmed: boolean }
const MAX_GENERATION = 0xffffffffffffffffn

/** Secrets live only in this instance. Dispose on account/network change or panel/provider teardown. */
export class NotesIdentityController {
  private readonly c: IdentityContext
  private readonly signal: AbortSignal
  private readonly listeners = new Set<() => void>()
  private epoch = 0
  private dead = false
  private busy = false
  private observed: IdentityChainState | null = null
  private seed: Uint8Array | null = null
  private unlockedGeneration: bigint | null = null
  private pending: Pending | null = null
  private readonly exposedKeys = new Set<Uint8Array>()
  private migrationPartial = false
  private snapshot: IdentitySnapshot = { phase: 'unknown', busy: false, recoveryConfirmed: false, migrationPartial: false }
  constructor(context: IdentityContext) {
    networkBytes(context)
    if (bech32Encode('g', requireBytes(context.addressBytes, 20)) !== context.address) throw new NotesCryptoError('identity')
    this.c = { ...context, addressBytes: context.addressBytes.slice() }
    this.signal = context.session.capture().signal
    this.signal.addEventListener('abort', this.lock)
  }
  getSnapshot = (): IdentitySnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(): void {
    const state = this.observed
    const mode = this.pending?.plan.mode ?? (state?.backup ? parseBackup(state.backup.record).binding.mode : undefined)
    this.snapshot = Object.freeze({
      phase: this.pending ? 'prepared' : this.seed ? 'unlocked' : !state ? 'unknown' : state.active ? 'locked' : state.generation === 0n ? 'empty' : 'revoked',
      busy: this.busy, generation: state?.generation.toString(), mode,
      recoveryConfirmed: this.pending?.confirmed ?? false, migrationPartial: this.pending?.plan.migrationPartial ?? this.migrationPartial,
    })
    this.listeners.forEach(listener => listener())
  }
  private guard(token: number): boolean { return !this.dead && !this.signal.aborted && token === this.epoch && this.c.isCurrent() }
  private assert(token: number): void { if (!this.guard(token)) throw new NotesCryptoError('identity') }
  private async run<T>(action: (token: number) => Promise<T>): Promise<T> {
    if (this.busy) throw new NotesCryptoError('busy')
    const token = this.epoch; this.assert(token); this.busy = true; this.emit()
    try { return await action(token) }
    finally { if (token === this.epoch) { this.busy = false; this.emit() } }
  }
  private async read(token: number): Promise<IdentityChainState> {
    const value = await this.c.read(); this.assert(token)
    if (typeof value.generation !== 'bigint' || value.generation < 0n || value.generation > MAX_GENERATION || typeof value.active !== 'boolean'
      || (value.active && value.generation === 0n) || value.publicKey.length !== (value.active ? 1216 : 0) || (value.backup && value.backup.record.length > 365)) throw new NotesCryptoError('identity')
    const state = { ...value, publicKey: new Uint8Array(value.publicKey), backup: value.backup ? { ...value.backup, record: new Uint8Array(value.backup.record) } : null }
    if (this.seed && (!state.active || state.generation !== this.unlockedGeneration || (this.observed && !equalBytes(state.publicKey, this.observed.publicKey)))) {
      this.seed.fill(0); this.seed = null; this.unlockedGeneration = null
      this.exposedKeys.forEach(key => key.fill(0))
    }
    if (state.backup) {
      const binding = parseBackup(state.backup.record).binding
      if (state.backup.revision < 1n || state.backup.revision > MAX_GENERATION || state.backup.height < 1n
        || binding.chainId !== this.c.chainId || binding.realm !== this.c.realm || !equalBytes(binding.address, this.c.addressBytes)
        || binding.generation > state.generation) throw new NotesCryptoError('identity')
      if (state.active && (binding.generation !== state.generation || !equalBytes(binding.publicKeyHash, sha256(state.publicKey)))) throw new NotesCryptoError('identity')
      if (binding.mode === 'vault' && binding.generation > 1n) this.migrationPartial = true
    }
    this.observed = state; return state
  }
  private binding(mode: BackupMode, generation: bigint, publicKey: Uint8Array): BackupBinding {
    return { mode, chainId: this.c.chainId, realm: this.c.realm, address: this.c.addressBytes.slice(), generation, publicKeyHash: sha256(publicKey) }
  }
  private activate(seed: Uint8Array, state: IdentityChainState, token: number): void {
    this.assert(token)
    const identity = verifiedIdentity(seed, state.publicKey); identity.secretKey.fill(0)
    this.seed?.fill(0); this.seed = seed.slice(); this.unlockedGeneration = state.generation
  }
  private async activateCurrent(seed: Uint8Array, expected: IdentityChainState, token: number): Promise<void> {
    const current = await this.read(token)
    if (!current.active || current.generation !== expected.generation || !equalBytes(current.publicKey, expected.publicKey)) throw new NotesCryptoError('identity')
    this.activate(seed, current, token)
  }
  async refresh(): Promise<void> { return this.run(async token => { await this.read(token) }) }
  async unlockStandard(wallet: unknown): Promise<void> {
    return this.run(async token => {
      const state = await this.read(token)
      if (!state.active || !state.backup || parseBackup(state.backup.record).binding.mode !== 'standard') throw new NotesCryptoError('identity')
      const signature = await requestNotesUnlock(wallet, { chainId: this.c.chainId, signer: this.c.address }, () => this.guard(token))
      let seed: Uint8Array | undefined
      try { seed = await recoverIdentity(state.backup.record, signature.ikm, this.binding('standard', state.generation, state.publicKey), state.publicKey); await this.activateCurrent(seed, state, token) }
      finally { signature.ikm.fill(0); seed?.fill(0) }
    })
  }
  /** Phrase-only for Vault's on-chain backup; a Standard recovery uses its downloaded encrypted file. */
  async recover(phrase: string, exportedFile?: string): Promise<void> {
    return this.run(async token => {
      const entropy = recoveryEntropy(phrase); let seed: Uint8Array | undefined
      try {
        const state = await this.read(token); if (!state.active) throw new NotesCryptoError('identity')
        const wanted = this.binding('vault', state.generation, state.publicKey)
        const records = exportedFile === undefined ? (state.backup ? [{ backup: state.backup.record, publicKey: state.publicKey }] : []) : readRecoveryFile(exportedFile)
        const matching = records.filter(value => {
          const b = parseBackup(value.backup).binding
          return b.mode === 'vault' && b.chainId === wanted.chainId && b.realm === wanted.realm && b.generation === wanted.generation && equalBytes(b.address, wanted.address) && equalBytes(value.publicKey, state.publicKey)
        })
        if (matching.length !== 1) throw new NotesCryptoError('identity')
        seed = await recoverIdentity(matching[0].backup, entropy, wanted, state.publicKey); await this.activateCurrent(seed, state, token)
      } finally { entropy.fill(0); seed?.fill(0) }
    })
  }
  /** An explicit setup/migration action. Nothing is registered or considered active yet. */
  async prepareSetup(mode: BackupMode, wallet?: unknown): Promise<{ phrase: string; exportText: string; migrationPartial: boolean }> {
    return this.run(async token => {
      if (this.pending) throw new NotesCryptoError('busy')
      if (mode !== 'standard' && mode !== 'vault') throw new NotesCryptoError('format')
      const state = await this.read(token), migrating = state.active
      if (state.generation === MAX_GENERATION || (migrating && (mode !== 'vault' || !this.seed || this.unlockedGeneration !== state.generation || !state.backup || parseBackup(state.backup.record).binding.mode !== 'standard'))) throw new NotesCryptoError('identity')
      const seed = randomBytes(32), entropy = randomBytes(32); let material: Uint8Array | undefined
      try {
        const identity = identityFromSeed(seed); identity.secretKey.fill(0)
        const generation = state.generation + 1n, binding = this.binding(mode, generation, identity.publicKey)
        if (mode === 'standard') {
          const first = await requestNotesUnlock(wallet, { chainId: this.c.chainId, signer: this.c.address }, () => this.guard(token))
          material = first.ikm
          const second = await requestNotesUnlock(wallet, { chainId: this.c.chainId, signer: this.c.address }, () => this.guard(token))
          try { if (!equalBytes(material, second.ikm)) throw new NotesCryptoError('signature') }
          finally { second.ikm.fill(0) }
        }
        const vaultBackup = await sealBackup(seed, entropy, { ...binding, mode: 'vault' }); this.assert(token)
        const backup = mode === 'vault' ? vaultBackup : await sealBackup(seed, material!, binding); this.assert(token)
        const records = [{ backup: vaultBackup, publicKey: identity.publicKey }]
        if (migrating) {
          // Retaining old keys recovers archives; it cannot repair their historical Standard exposure.
          const archive = await sealBackup(this.seed!, entropy, this.binding('vault', state.generation, state.publicKey)); this.assert(token)
          records.push({ backup: archive, publicKey: state.publicKey })
        }
        this.pending = { seed: seed.slice(), recovery: entropy.slice(), confirmed: false, plan: {
          operationId: bytesToHex(randomBytes(16)), expectedGeneration: state.generation, expectedBackupRevision: state.backup?.revision ?? 0n,
          generation, mode, publicKey: identity.publicKey.slice(), backup: backup.slice(), migrationPartial: migrating,
        } }
        return { phrase: recoveryPhrase(entropy), exportText: recoveryFile(records), migrationPartial: migrating }
      } finally { seed.fill(0); entropy.fill(0); material?.fill(0) }
    })
  }
  confirmRecovery(phrase: string): void {
    this.assert(this.epoch)
    if (!this.pending || this.busy || this.pending.confirmed) throw new NotesCryptoError('identity')
    const entropy = recoveryEntropy(phrase)
    try { if (!equalBytes(entropy, this.pending.recovery)) throw new NotesCryptoError('identity'); this.pending.confirmed = true; this.pending.recovery.fill(0); this.emit() }
    finally { entropy.fill(0) }
  }
  preparedPlan(): IdentitySetupPlan {
    this.assert(this.epoch)
    if (!this.pending?.confirmed) throw new NotesCryptoError('identity')
    return { ...this.pending.plan, publicKey: this.pending.plan.publicKey.slice(), backup: this.pending.plan.backup.slice() }
  }
  /** Caller must establish a matching durable not-sent receipt before requesting a new review. */
  renewPreparedOperation(previousOperationId: string): IdentitySetupPlan {
    this.assert(this.epoch)
    if (this.busy || !this.pending?.confirmed || this.pending.plan.operationId !== previousOperationId) throw new NotesCryptoError('identity')
    const next = bytesToHex(randomBytes(16))
    if (next === previousOperationId || /^0+$/.test(next)) throw new NotesCryptoError('identity')
    this.pending.plan.operationId = next
    return this.preparedPlan()
  }
  /** Only exact current registry AND backup receipts activate the prepared seed. */
  async confirmSetup(): Promise<boolean> {
    return this.run(async token => {
      if (!this.pending?.confirmed) throw new NotesCryptoError('identity')
      const pending = this.pending, plan = pending.plan, state = await this.read(token)
      if (!state.active || state.generation !== plan.generation || !equalBytes(state.publicKey, plan.publicKey) || state.keyOperationId !== plan.operationId || state.keyHeight < 1n
        || !state.backup || state.backup.operationId !== plan.operationId || state.backup.height !== state.keyHeight || state.backup.revision !== plan.expectedBackupRevision + 1n || !equalBytes(state.backup.record, plan.backup)) return false
      this.activate(pending.seed, state, token); this.migrationPartial = plan.migrationPartial
      pending.seed.fill(0); pending.recovery.fill(0); this.pending = null; return true
    })
  }
  /** The callback receives temporary key copies, zeroed after it completes. */
  async use<T>(action: (identity: NotesIdentity) => Promise<T> | T): Promise<T> {
    return this.run(async token => {
      const state = await this.read(token)
      if (!state.active || !this.seed || this.unlockedGeneration !== state.generation) throw new NotesCryptoError('identity')
      const identity = verifiedIdentity(this.seed, state.publicKey)
      this.exposedKeys.add(identity.secretKey)
      try { const result = await action(identity); this.assert(token); return result }
      finally { identity.secretKey.fill(0); this.exposedKeys.delete(identity.secretKey) }
    })
  }
  lock = (): void => {
    this.epoch++; this.busy = false; this.seed?.fill(0); this.seed = null; this.unlockedGeneration = null
    this.exposedKeys.forEach(key => key.fill(0)); this.exposedKeys.clear()
    this.pending?.seed.fill(0); this.pending?.recovery.fill(0); this.pending = null; this.emit()
  }
  dispose(): void { this.dead = true; this.signal.removeEventListener('abort', this.lock); this.lock(); this.listeners.clear() }
}

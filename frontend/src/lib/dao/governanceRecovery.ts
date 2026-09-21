import { z } from 'zod'
export type GovernanceScope = { chainId: string; realmPath: string; caller: string; operation: string }
export const governanceKey = (s: GovernanceScope) => `memba_governance:v1:${JSON.stringify([s.chainId, s.realmPath, s.caller, s.operation])}`
const receiptSchema = z.object({ phase: z.enum(['intent', 'submitted', 'confirmed']), hash: z.string().max(128), label: z.string().max(256), proposalId: z.number().int().positive().optional() })
export type GovernanceReceipt = z.infer<typeof receiptSchema>
const memory = new Map<string, GovernanceReceipt>()
const active = new Set<string>()
export function readGovernanceReceipt(scope: GovernanceScope): GovernanceReceipt | null {
    const key = governanceKey(scope)
    if (memory.has(key)) return memory.get(key)!
    try { return receiptSchema.parse(JSON.parse(localStorage.getItem(key) || 'null')) }
    catch { return null }
}
/** Initial intent must be durable before opening a wallet. Later receipts also
 * stay in memory if browser storage becomes unavailable after submission. */
export function saveGovernanceReceipt(scope: GovernanceScope, value: GovernanceReceipt): void {
    const key = governanceKey(scope)
    try { localStorage.setItem(key, JSON.stringify(value)); memory.delete(key) }
    catch (error) { if (value.phase !== 'intent') memory.set(key, value); throw error }
}
export function clearGovernanceReceipt(scope: GovernanceScope) {
    const key = governanceKey(scope)
    if (active.has(key)) throw new Error('A wallet request is still in progress. Finish it before reviewing another attempt.')
    localStorage.removeItem(key)
    memory.delete(key)
}
export function governanceRequestActive(scope: GovernanceScope) { return active.has(governanceKey(scope)) }
export function beginGovernanceRequest(scope: GovernanceScope) {
    const key = governanceKey(scope)
    if (active.has(key)) throw new Error('This request is already in progress.')
    active.add(key)
    return () => { active.delete(key) }
}
const draftSchema = z.object({ kind: z.enum(['text', 'add_member', 'remove_member', 'change_role', 'archive']), title: z.string(), description: z.string(), category: z.string().nullable(), target: z.string(), powerText: z.string(), roles: z.array(z.string()).nullable() })
export type ProposalDraft = z.infer<typeof draftSchema>
const drafts = new Map<string, ProposalDraft>()
const draftKey = (s: GovernanceScope) => governanceKey(s) + ':draft'
export function readProposalDraft(scope: GovernanceScope): ProposalDraft | null {
    if (drafts.has(draftKey(scope))) return drafts.get(draftKey(scope))!
    try { return draftSchema.parse(JSON.parse(localStorage.getItem(draftKey(scope)) || 'null')) } catch { return null }
}
export function saveProposalDraft(scope: GovernanceScope, draft: ProposalDraft) {
    drafts.set(draftKey(scope), draft)
    localStorage.setItem(draftKey(scope), JSON.stringify(draft))
}
export function clearProposalDraft(scope: GovernanceScope) {
    localStorage.removeItem(draftKey(scope))
    drafts.delete(draftKey(scope))
}
/** Test isolation for page-lifetime fallbacks. */
export function clearGovernanceMemory() { memory.clear(); drafts.clear(); active.clear() }

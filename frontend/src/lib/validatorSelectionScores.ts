/**
 * The validator selection scores: the final ranking of validator candidates,
 * computed by gno-score-validator from their results on the gno.land testnets
 * and published in gno.land/r/samcrew/validator_scores as numbered, append-only
 * editions (a sealed edition never changes). Memba reads the latest sealed
 * edition through `vm/qeval` LatestJSON(), read-only.
 *
 * Scores are integers in hundredths on chain (87.43 is 8743), shown with one
 * decimal. A read that fails, an edition not published yet and a payload that
 * does not match the contract all give `null`: the feature then shows nothing,
 * never an empty or zero score. A single row that breaks the contract is left
 * out, so its operator shows a dash.
 *
 * @module lib/validatorSelectionScores
 */
import { GNO_RPC_URL } from "./config"
import { parseQevalJSON, queryEval } from "./dao/shared"

/** How long a read stays fresh: an edition changes a few times at most, ever. */
export const SELECTION_SCORES_STALE_MS = 5 * 60_000

export interface SelectionScoreEntry {
    /** Lowercase operator address (gno.land/r/gnops/valopers). */
    operator: string
    moniker: string
    /** Hundredths. */
    total: number
    rank: number
    /** GitHub bonus, hundredths. */
    github: number
    /** Hundredths, in the edition's `arenas` order. */
    arenaScores: readonly number[]
}

export interface SelectionScoreEdition {
    number: number
    /** RFC 3339, from scorecard.json `generated_at`. */
    computedAt: string
    scorecardSHA256: string
    arenas: readonly string[]
    /** Keyed by lowercase operator address. */
    candidates: ReadonlyMap<string, SelectionScoreEntry>
}

/** A row the candidates list can order: an operator and its registry name. */
export interface ScoredRow {
    operatorAddress: string
    moniker: string
}

const OPERATOR_RE = /^g1[a-z0-9]{38}$/
const SHA256_RE = /^[0-9a-f]{64}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => Number.isSafeInteger(v)
const isPositiveInt = (v: unknown): v is number => isInt(v) && v > 0
const isName = (v: unknown): v is string => typeof v === "string" && v !== ""

function parseEntry(v: unknown, arenaCount: number): SelectionScoreEntry | null {
    if (!isRecord(v)) return null
    const { operator, moniker, total, rank, github, arenaScores } = v
    if (typeof operator !== "string") return null
    const address = operator.toLowerCase()
    if (!OPERATOR_RE.test(address) || typeof moniker !== "string") return null
    if (!isInt(total) || !isPositiveInt(rank) || !isInt(github)) return null
    if (!Array.isArray(arenaScores)) return null
    const scores: unknown[] = arenaScores
    if (scores.length !== arenaCount || !scores.every(isInt)) return null
    return { operator: address, moniker, total, rank, github, arenaScores: scores.slice() }
}

/** Parse a LatestJSON()/EditionJSON(n) qeval answer, or null (see the module note). */
export function parseSelectionScores(raw: string | null): SelectionScoreEdition | null {
    if (!raw) return null
    const v = parseQevalJSON(raw)
    if (!isRecord(v)) return null
    const { number: editionNumber, computedAt, scorecardSHA256, arenas, candidates } = v
    if (!isPositiveInt(editionNumber) || !isName(computedAt)) return null
    if (typeof scorecardSHA256 !== "string" || !SHA256_RE.test(scorecardSHA256)) return null
    if (!Array.isArray(arenas) || !Array.isArray(candidates)) return null
    const names: unknown[] = arenas
    if (names.length === 0 || !names.every(isName)) return null
    const rows: unknown[] = candidates
    const byOperator = new Map<string, SelectionScoreEntry>()
    for (const row of rows) {
        const entry = parseEntry(row, names.length)
        // The first row for an operator wins; the realm rejects duplicates anyway.
        if (entry && !byOperator.has(entry.operator)) byOperator.set(entry.operator, entry)
    }
    return { number: editionNumber, computedAt, scorecardSHA256, arenas: names.slice(), candidates: byOperator }
}

/** The latest sealed edition on `realmPath`, or null (no path, no edition, failed read, broken payload). */
export async function fetchLatestSelectionScores(realmPath: string): Promise<SelectionScoreEdition | null> {
    if (!realmPath) return null
    try {
        return parseSelectionScores(await queryEval(GNO_RPC_URL, realmPath, "LatestJSON()"))
    } catch {
        return null
    }
}

export function selectionScoreFor(edition: SelectionScoreEdition, operatorAddress: string): SelectionScoreEntry | undefined {
    return edition.candidates.get(operatorAddress.toLowerCase())
}

/** Hundredths to one decimal, half away from zero, in integer maths (no float drift): 8743 → "87.4", 8745 → "87.5". */
export function formatHundredths(n: number): string {
    const tenths = Math.round(Math.abs(n) / 10)
    const sign = n < 0 && tenths > 0 ? "-" : ""
    return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}`
}

/** "87.4 · #3": total and rank. */
export function formatSelectionScore(entry: Pick<SelectionScoreEntry, "total" | "rank">): string {
    return `${formatHundredths(entry.total)} · #${entry.rank}`
}

/** "13 Oct 2026" (UTC day of the computation), or the text as given when it is not a date. */
export function formatEditionDate(computedAt: string): string {
    const time = Date.parse(computedAt)
    if (Number.isNaN(time)) return computedAt
    return new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

const ARENA_LABELS: Readonly<Record<string, string>> = {
    challenge: "Challenge",
    test13: "Test13",
    topaz: "Topaz",
    sapphire: "Sapphire",
    pearl: "Pearl",
    firedrill: "Fire drill",
}

/** A readable arena name; an arena this file does not know is shown as the realm wrote it. */
export function arenaLabel(name: string): string {
    return Object.hasOwn(ARENA_LABELS, name) ? ARENA_LABELS[name] : name
}

/** Ascending; a missing total sorts below every real one, as the roster's other figures do. */
export function compareTotals(a: number | null, b: number | null): number {
    if (a === null) return b === null ? 0 : -1
    if (b === null) return 1
    return a - b
}

/** The candidates' default order: highest total first, operators without a score last, then by name. */
export function byScoreThenMoniker(edition: SelectionScoreEdition): (a: ScoredRow, b: ScoredRow) => number {
    const total = (row: ScoredRow) => selectionScoreFor(edition, row.operatorAddress)?.total ?? null
    return (a, b) => compareTotals(total(b), total(a)) || a.moniker.localeCompare(b.moniker)
}

/** One cache entry per network, shared by the Validators window and the validator page. */
export const selectionScoresQueryKey = (networkKey: string) => ["validators", "selection-scores", networkKey] as const

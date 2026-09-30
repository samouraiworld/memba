/**
 * One strict query of an NFT realm. A query that fails, or an answer that
 * cannot be decoded, throws: it is never returned as an empty or a default
 * value. A read that reached no answer throws a ReadError (worth retrying), a
 * query the realm refused throws a RealmRefusedError (asking again gets the
 * same refusal), and an answer that breaks the realm's contract throws a plain
 * Error. Callers validate every argument before it goes into an expression,
 * so no argument can change what is evaluated.
 *
 * @module lib/nft/read
 */
import { GNO_RPC_URL } from "../config"
import { parseQevalJSON, queryEval } from "../dao/shared"
import { AbciQueryError } from "../rpcFallback"
import { INT64_MAX, decimal, list } from "./parse"

/** The read did not reach an answer: no node answered, or none from this chain. It may succeed if tried again. */
export class ReadError extends Error {}

/**
 * The realm refused the query: it panicked, as it does for a collection, a
 * token or a stage that does not exist. The chain answered, so asking again
 * gets the same refusal.
 */
export class RealmRefusedError extends Error {}

async function evaluate(realm: string, expr: string, what: string): Promise<string> {
    let raw: string | null
    try {
        // The query picks a node of the session network and fails over by itself; the URL does not choose one.
        raw = await queryEval(GNO_RPC_URL, realm, expr, true)
    } catch (cause) {
        if (cause instanceof AbciQueryError) throw new RealmRefusedError(`The realm refused to read ${what}`, { cause })
        throw new ReadError(`Could not read ${what}`, { cause })
    }
    if (raw === null) throw new ReadError(`Could not read ${what}`)
    return raw
}

export async function readJSON(realm: string, expr: string, what: string): Promise<unknown> {
    const raw = await evaluate(realm, expr, what)
    const value = parseQevalJSON(raw)
    // The decoder answers null for what it cannot decode, and null is also an answer the realms give.
    if (value === null && !/^\(\s*"null"\s+string\s*\)\s*$/.test(raw)) throw new Error(`Invalid ${what}`)
    return value
}

/** A list of 1 to 50 entries holds that many rows at most. */
const sized = (size: number) => Number.isSafeInteger(size) && size >= 1 && size <= 50

/**
 * One slice of a list: up to `size` rows, never more than were asked for.
 * Where it starts is the last of `args`: a page, or a cursor whose caller
 * checks that the rows lie past it.
 */
export async function readSlice(realm: string, view: string, args: readonly string[], size: number, what: string): Promise<unknown[]> {
    if (!sized(size)) throw new Error(`Invalid ${what} list size`)
    const rows = list(await readJSON(realm, `${view}(${[...args, size].join(", ")})`, `${what}s`), `${what} list`)
    if (rows.length > size) throw new Error(`Invalid ${what} list`)
    return rows
}

/** One page of a list: zero-based, 1 to 50 entries, and never more rows than were asked for. */
export async function readPage(realm: string, view: string, args: readonly string[], page: number, size: number, what: string): Promise<unknown[]> {
    if (!Number.isSafeInteger(page) || page < 0 || !sized(size)) throw new Error(`Invalid ${what} page`)
    return readSlice(realm, view, [...args, String(page)], size, what)
}

/** A count or an amount, which qeval prints as `(3 int64)`. None of the realms answers a negative one. */
export async function readInt(realm: string, expr: string, what: string): Promise<bigint> {
    const match = /^\((\d+) int64\)$/.exec((await evaluate(realm, expr, what)).trim())
    if (!match) throw new Error(`Invalid ${what}`)
    return decimal(match[1], what)
}

/** A yes or no, which qeval prints as `(true bool)`. */
export async function readBool(realm: string, expr: string, what: string): Promise<boolean> {
    const raw = (await evaluate(realm, expr, what)).trim()
    if (raw !== "(true bool)" && raw !== "(false bool)") throw new Error(`Invalid ${what}`)
    return raw === "(true bool)"
}

/**
 * A non-negative integer argument, checked at run time: its type alone does
 * not keep text out of an expression. A bigint goes into an int64 parameter,
 * so it is held to one.
 */
export function natural<T extends bigint | number>(value: T, what: string): T {
    if (!(typeof value === "bigint" ? value >= 0n && value <= INT64_MAX : Number.isSafeInteger(value) && value >= 0)) throw new Error(`Invalid ${what}`)
    return value
}

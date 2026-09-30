/**
 * One strict query of an NFT realm. A query that fails, or an answer that
 * cannot be decoded, throws: it is never returned as an empty or a default
 * value. Callers validate every argument before it goes into an expression,
 * so no argument can change what is evaluated.
 *
 * @module lib/nft/read
 */
import { parseQevalJSON, queryEval } from "../dao/shared"
import { list } from "./parse"

/** A missing answer is an error ("could not read"), never an empty result. */
async function evaluate(rpcUrl: string, realm: string, expr: string, what: string): Promise<string> {
    const raw = await queryEval(rpcUrl, realm, expr, true)
    if (raw === null) throw new Error(`Could not read ${what}`)
    return raw
}

export async function readJSON(rpcUrl: string, realm: string, expr: string, what: string): Promise<unknown> {
    const raw = await evaluate(rpcUrl, realm, expr, what)
    const value = parseQevalJSON(raw)
    // The decoder answers null for what it cannot decode, and null is also an answer the realms give.
    if (value === null && !/^\(\s*"null"\s+string\s*\)\s*$/.test(raw)) throw new Error(`Invalid ${what}`)
    return value
}

/** One page of a list: zero-based, 1 to 50 entries, and never more rows than were asked for. */
export async function readPage(rpcUrl: string, realm: string, view: string, args: readonly string[], page: number, size: number, what: string): Promise<unknown[]> {
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 50) throw new Error(`Invalid ${what} page`)
    const rows = list(await readJSON(rpcUrl, realm, `${view}(${[...args, page, size].join(", ")})`, `${what}s`), `${what} list`)
    if (rows.length > size) throw new Error(`Invalid ${what} list`)
    return rows
}

/** A count or an amount, which qeval prints as `(3 int64)`. None of the realms answers a negative one. */
export async function readInt(rpcUrl: string, realm: string, expr: string, what: string): Promise<bigint> {
    const match = /^\((0|[1-9]\d*) int64\)$/.exec((await evaluate(rpcUrl, realm, expr, what)).trim())
    if (!match) throw new Error(`Invalid ${what}`)
    return BigInt(match[1])
}

/** A yes or no, which qeval prints as `(true bool)`. */
export async function readBool(rpcUrl: string, realm: string, expr: string, what: string): Promise<boolean> {
    const raw = (await evaluate(rpcUrl, realm, expr, what)).trim()
    if (raw !== "(true bool)" && raw !== "(false bool)") throw new Error(`Invalid ${what}`)
    return raw === "(true bool)"
}

/** A non-negative integer argument, checked at run time: its type alone does not keep text out of an expression. */
export function natural<T extends bigint | number>(value: T, what: string): T {
    if (!(typeof value === "bigint" ? value >= 0n : Number.isSafeInteger(value) && value >= 0)) throw new Error(`Invalid ${what}`)
    return value
}

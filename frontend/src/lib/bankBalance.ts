/**
 * The ugnot in the chain's bank/balances answer.
 *
 * @module lib/bankBalance
 */

/**
 * The bank endpoint answers with Amino JSON of the coin string. An explicit
 * empty coin string means zero; missing or malformed data is an error, never zero.
 */
export function ugnotInCoinsJson(json: string): bigint {
    const coins: unknown = JSON.parse(json)
    if (typeof coins !== "string") throw new Error("Unexpected balance response")
    if (coins && !/^[0-9]+[a-zA-Z][a-zA-Z0-9/._-]*(?:,[0-9]+[a-zA-Z][a-zA-Z0-9/._-]*)*$/.test(coins)) throw new Error("Unexpected balance response")
    const match = /(?:^|,)([0-9]+)ugnot(?:,|$)/.exec(coins)
    return match ? BigInt(match[1]) : 0n
}

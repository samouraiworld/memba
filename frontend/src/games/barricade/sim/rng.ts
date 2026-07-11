/**
 * Seeded integer RNG for the sim — xorshift32 over uint32 state.
 * Pure functions: state in, state out; the state lives in SimState.rngState
 * so replays serialize trivially. Never returns 0 (xorshift's absorbing state).
 */

export function rngNext(state: number): number {
    let x = state >>> 0
    x ^= (x << 13) >>> 0
    x ^= x >>> 17
    x ^= (x << 5) >>> 0
    x >>>= 0
    return x === 0 ? 0x9e3779b9 : x
}

/** Uniform-ish int in [0, maxExclusive) plus the advanced state. */
export function rngInt(state: number, maxExclusive: number): [number, number] {
    const next = rngNext(state)
    return [next % maxExclusive, next]
}

/** FNV-1a 32-bit over the seed string, coerced non-zero. */
export function seedToState(seed: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h === 0 ? 0x9e3779b9 : h
}

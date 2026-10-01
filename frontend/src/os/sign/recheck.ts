/**
 * A signing request's recheck reads the chain's state and the network price
 * together: one wait before the wallet opens instead of two.
 *
 * @module os/sign/recheck
 */

/**
 * The state's refusal comes first (its read, then `check` on what it read),
 * whichever answer arrives first; the price's refusal after it.
 */
export async function withFeeCheck<T>(state: Promise<T>, fee: Promise<unknown>, check: (value: T) => void = () => {}): Promise<T> {
    const [read, priced] = await Promise.allSettled([state, fee])
    if (read.status === "rejected") throw read.reason
    check(read.value)
    if (priced.status === "rejected") throw priced.reason
    return read.value
}

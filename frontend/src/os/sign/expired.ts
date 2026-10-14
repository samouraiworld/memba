/**
 * A request's recheck found its price quote expired (by time or by blocks) before the wallet opened.
 * Nothing was sent; a request with `requote` can be priced again in place.
 *
 * @module os/sign/expired
 */
export class QuoteExpiredError extends Error {
    constructor() {
        super("The price quote expired. Nothing was sent.")
        this.name = "QuoteExpiredError"
    }
}

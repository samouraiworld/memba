import { describe, expect, it } from "vitest"

import { MINT_GAS_WANTED } from "./mint"
import { APPLY_GAS_WANTED, REVIEW_GAS_WANTED } from "./review"
import {
    ACCEPT_OFFER_GAS_WANTED, BUY_GAS_WANTED, CANCEL_LISTING_GAS_WANTED, CANCEL_OFFER_GAS_WANTED, LIST_GAS_WANTED, MAKE_OFFER_GAS_WANTED,
} from "./trade"

/*
 * The most gas each signed transaction was measured to use, in millions, on the
 * Launchpad bytes of samcrew-deployer 5391626: the committed-node fixtures with
 * fixed keys on Gno v1.5.0 and on the v1.6.0 candidate (the higher of the two;
 * they differ by 0.14% at most), and the earlier fixtures at the pin e75fef8
 * where they measured more (curation's Apply and Review, 18 to 19M). Random
 * keys move a fixture by up to 7%, and a live chain's trees are deeper than a
 * test node's, so every limit is at least twice its measurement: a transaction
 * that runs out of gas still pays its fee. Measure again whenever those bytes change.
 */
const MEASURED: [string, number, number][] = [
    ["Mint", MINT_GAS_WANTED, 26.4],
    ["Approve + List", LIST_GAS_WANTED, 12.82 + 17.54],
    ["Buy", BUY_GAS_WANTED, 30.02],
    ["Cancel", CANCEL_LISTING_GAS_WANTED, 12.52],
    ["MakeOffer", MAKE_OFFER_GAS_WANTED, 18.14],
    ["CancelOffer", CANCEL_OFFER_GAS_WANTED, 10.49],
    ["Approve + AcceptOffer", ACCEPT_OFFER_GAS_WANTED, 12.82 + 30.16],
    ["Apply", APPLY_GAS_WANTED, 19],
    ["Review", REVIEW_GAS_WANTED, 19],
]

describe("gas limits", () => {
    it.each(MEASURED)("%s may use at least twice the gas it was measured to", (_, limit, millions) => {
        expect(limit).toBeGreaterThanOrEqual(2 * millions * 1_000_000)
    })
})

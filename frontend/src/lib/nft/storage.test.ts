import { describe, expect, it } from "vitest"

import { depositCapUgnot } from "../dao/v2Budget"
import { MINT_STORAGE_BYTES } from "./mint"
import { APPLY_STORAGE_BYTES, REVIEW_STORAGE_BYTES } from "./review"
import { ACCEPT_OFFER_STORAGE_BYTES, APPROVE_STORAGE_BYTES, BUY_STORAGE_BYTES, LIST_STORAGE_BYTES, OFFER_STORAGE_BYTES } from "./trade"

/*
 * The most new storage each signed message was measured to take, in bytes, on
 * the Launchpad bytes of samcrew-deployer 57f108a at the pinned Gno e75fef8: the
 * committed-node fixtures nft_ledger, nft_drops, nft_stages, nft_market,
 * nft_offers and curation, and direct calls on a local onyx-1 node (a listing
 * 7,790 bytes, an offer 7,813). A message whose storage exceeds its deposit
 * cap fails on chain; every cap is twice its estimate, so each estimate covers
 * its measurement. Measure again whenever those bytes change.
 */
const MEASURED: [string, number, number][] = [
    ["Approve", APPROVE_STORAGE_BYTES, 2_118],
    ["List", LIST_STORAGE_BYTES, 7_790],
    ["MakeOffer", OFFER_STORAGE_BYTES, 7_813],
    // A purchase or an acceptance moves the token: a transfer to a new holder stores up to 3,887 bytes.
    ["Buy", BUY_STORAGE_BYTES, 3_887],
    ["AcceptOffer", ACCEPT_OFFER_STORAGE_BYTES, 3_887],
    ["Mint", MINT_STORAGE_BYTES, 9_967],
    ["Apply", APPLY_STORAGE_BYTES, 4_535],
    ["Review", REVIEW_STORAGE_BYTES, 164],
]

describe("storage deposit caps", () => {
    it.each(MEASURED)("%s may store at least twice what it was measured to", (_, estimate, measured) => {
        expect(estimate).toBeGreaterThanOrEqual(measured)
        expect(depositCapUgnot(estimate)).toBeGreaterThanOrEqual(2 * measured * 100)
    })
})

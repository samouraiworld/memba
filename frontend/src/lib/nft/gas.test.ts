import { describe, expect, it } from "vitest"

import { createCollectionGasWanted, termsProblem, type CollectionTerms } from "./create"
import { MINT_GAS_WANTED } from "./mint"
import { APPLY_GAS_WANTED, REVIEW_GAS_WANTED } from "./review"
import {
    ACCEPT_OFFER_GAS_WANTED, BUY_GAS_WANTED, CANCEL_LISTING_GAS_WANTED, CANCEL_OFFER_GAS_WANTED, LIST_GAS_WANTED, MAKE_OFFER_GAS_WANTED,
} from "./trade"
import { ADD_STAGE_GAS_WANTED, END_STAGE_GAS_WANTED } from "./studio"

/*
 * The most gas each signed transaction was measured to use, in millions, on the
 * Launchpad bytes of samcrew-deployer 5391626: the committed-node fixtures with
 * fixed keys on Gno v1.5.0 and on the v1.6.0 candidate (the higher of the two;
 * they differ by 0.14% at most), and the earlier fixtures at the pin e75fef8
 * where they measured more (curation's Apply and Review, 18 to 19M), and direct
 * calls at the pin on a collection paying ten royalty receivers (Approve, Buy and
 * AcceptOffer: each receiver paid adds about 0.7M). Random
 * keys move a fixture by up to 7%, and a live chain's trees are deeper than a
 * test node's, so every limit is at least twice its measurement: a transaction
 * that runs out of gas still pays its fee. Measure again whenever those bytes change.
 */
const MEASURED: [string, number, number][] = [
    ["Mint", MINT_GAS_WANTED, 26.4],
    // Measured on onyx-1 at the published bytes, above the test node: a relisting after the token came back.
    ["Approve + List", LIST_GAS_WANTED, 14.58 + 18.75],
    ["Buy", BUY_GAS_WANTED, 33.23],
    ["Cancel", CANCEL_LISTING_GAS_WANTED, 14.37], // onyx-1
    ["MakeOffer", MAKE_OFFER_GAS_WANTED, 18.14],
    ["CancelOffer", CANCEL_OFFER_GAS_WANTED, 10.49],
    ["Approve + AcceptOffer", ACCEPT_OFFER_GAS_WANTED, 12.96 + 33.05],
    ["Apply", APPLY_GAS_WANTED, 19],
    ["Review", REVIEW_GAS_WANTED, 19],
    // Fixed, dutch and holder stages (Memba schedules no allowlist stage), the tenth of a collection the worst.
    ["AddStage", ADD_STAGE_GAS_WANTED, 14.47],
    // Measured on onyx-1 at the published bytes, above the test node's 10.18M.
    ["EndStage", END_STAGE_GAS_WANTED, 10.78],
]

/* A creation's gas grows with its terms; measured at the pin by direct calls. */
const RECEIVERS = [
    "g10h8pyer5eykry55pvczajdyyf6333qfc9tudk6", "g18sl07dcynl3y03y3jselpdslsru6m6pjlzzf02", "g1ehpkrperur2kr5an2k7nhsa2w8vz09ycxx005m",
    "g1jqnlhxpscv8t2nn6976hd0q2vdtdrg20acutfx", "g1k8klmzawesrsqucky9lajsrg7z5jptqpdtgl5n", "g1kqjkwj3kfmzd9t0m33a8tezgtdux9pkq5tk3mt",
    "g1lzncsnl2dze9ey2lckpk8a0fs4n430s4z4930v", "g1mwvwckpd84jpue0vf3ywl2799yqnz0al5ngqvv", "g1ts6jvv0m4utnyvead4sjp8wvzxqnzegzdyn73k",
    "g1zk2mfn8e83wcgd07j99dcc5h589m27spcvmjvc",
].map((account) => ({ account, bps: 100n }))
const SHORTEST: CollectionTerms = {
    name: "S", symbol: "S", description: "", image: "", banner: "", website: "", mode: "open", revocable: false,
    maxSupply: 0n, metadataMode: "static", baseURI: "ipfs://x/", royalties: [],
}
const LONG = {
    description: "d".repeat(280), image: `https://${"i".repeat(192)}`, banner: `https://${"b".repeat(192)}`,
    website: `https://${"w".repeat(192)}`, baseURI: `ipfs://bafy${"a".repeat(188)}/`,
}
/** The longest terms the form accepts: every text at the ledger's limit, ten royalty receivers. */
const LONGEST: CollectionTerms = {
    ...SHORTEST, ...LONG, name: "N".repeat(32), symbol: "SYMBOLXYZW", mode: "royalty_protected", metadataMode: "mutable",
    maxSupply: 9_223_372_036_854_775_807n, royalties: RECEIVERS,
}
const CREATIONS: [string, CollectionTerms, number][] = [
    ["the shortest terms", SHORTEST, 20.75],
    ["ten royalty receivers", { ...SHORTEST, royalties: RECEIVERS }, 31.55],
    ["the longest description", { ...SHORTEST, description: LONG.description }, 24.41],
    ["the longest image", { ...SHORTEST, image: LONG.image }, 35.0],
    ["the longest links and description", { ...SHORTEST, ...LONG }, 85.58],
    ["the longest terms", LONGEST, 96.96],
    // Text outside ASCII costs more per byte, the most for symbols outside Latin-1.
    ["a description of emoji", { ...SHORTEST, description: "\u{1F600}".repeat(70) }, 46.12],
    ["a description of symbols", { ...SHORTEST, description: "\u07F6".repeat(140) }, 67.59],
    ["a name of symbols", { ...SHORTEST, name: "\u07FF".repeat(16) }, 26.25],
    ["the costliest terms", { ...LONGEST, name: "\u07F6".repeat(16), description: "\u07F6".repeat(140) }, 144.63],
]

describe("gas limits", () => {
    it.each(CREATIONS)("a creation with %s may use at least twice the gas it was measured to", (_, terms, millions) => {
        expect(termsProblem(terms)).toBe("")
        expect(createCollectionGasWanted(terms)).toBeGreaterThanOrEqual(2 * millions * 1_000_000)
    })

    it.each(MEASURED)("%s may use at least twice the gas it was measured to", (_, limit, millions) => {
        expect(limit).toBeGreaterThanOrEqual(2 * millions * 1_000_000)
    })
})

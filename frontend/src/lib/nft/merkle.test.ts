import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { allowlistLeaf, merkleProof, merkleRoot, traitLeaf, verifyProof } from "./merkle"

/**
 * Printed by the on-chain package itself (p/samcrew/launchpad/merkle/v1): the
 * root of the first N leaves, then each leaf with its proof, and one trait leaf.
 */
const VECTORS = `
N 1 ROOT 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533
  LEAF 0 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533 PROOF
N 2 ROOT 5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511
  LEAF 0 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533 PROOF 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056
  LEAF 1 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056 PROOF 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533
N 3 ROOT 40eeade4b7c383f96ceb6b255bd678f374aa2106e2e029a0693a6ffcb770235c
  LEAF 0 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533 PROOF 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056,4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf
  LEAF 1 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056 PROOF 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533,4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf
  LEAF 2 4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf PROOF 5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511
N 4 ROOT fe05842097b7ebcf90aee8d7e30e0f342940b8b8fd16700d480a2eec6430dced
  LEAF 0 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533 PROOF 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056,3da9b886a72dfdba578007f3be8561c817c77efa684536a4c8ee1d022f49b400
  LEAF 1 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056 PROOF 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533,3da9b886a72dfdba578007f3be8561c817c77efa684536a4c8ee1d022f49b400
  LEAF 2 4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf PROOF effd39912ca7fef85b4fb3295f654848706e1ceb5ecf882e01b8d2dd86680540,5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511
  LEAF 3 effd39912ca7fef85b4fb3295f654848706e1ceb5ecf882e01b8d2dd86680540 PROOF 4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf,5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511
N 5 ROOT 791afe4dbea3424bca76955dbdbd1241d180e4fa423a01281248999bb0da8ed6
  LEAF 0 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533 PROOF 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056,3da9b886a72dfdba578007f3be8561c817c77efa684536a4c8ee1d022f49b400,106fb4b4bd8e89c92e657c1c876b9eab31dee97c9d10333aab4f08e32d829d43
  LEAF 1 94fb0c8a29950597c097d37ad384c294cc7ca6e7dc7ce67a13ef8bcf0aad0056 PROOF 76f5c1fc8585496de5203181e8a95454787d4b6da1ce69913fb6b61f97756533,3da9b886a72dfdba578007f3be8561c817c77efa684536a4c8ee1d022f49b400,106fb4b4bd8e89c92e657c1c876b9eab31dee97c9d10333aab4f08e32d829d43
  LEAF 2 4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf PROOF effd39912ca7fef85b4fb3295f654848706e1ceb5ecf882e01b8d2dd86680540,5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511,106fb4b4bd8e89c92e657c1c876b9eab31dee97c9d10333aab4f08e32d829d43
  LEAF 3 effd39912ca7fef85b4fb3295f654848706e1ceb5ecf882e01b8d2dd86680540 PROOF 4693e6488234ad126602d2a853276c3205fdfb88f325684949189f132be08daf,5eb0cdc6c5bc116f64c23bdb756be2f989cc603427f073254d6c14f98e4fa511,106fb4b4bd8e89c92e657c1c876b9eab31dee97c9d10333aab4f08e32d829d43
  LEAF 4 106fb4b4bd8e89c92e657c1c876b9eab31dee97c9d10333aab4f08e32d829d43 PROOF fe05842097b7ebcf90aee8d7e30e0f342940b8b8fd16700d480a2eec6430dced
TRAIT 22d6610a555b85c4a15bd8a92b73c8fb1621cee8ebc2dc5301e96dd0f6e57e03
`

interface Tree { root: string; leaves: string[]; proofs: string[] }

const trees: Tree[] = []
let trait = ""
for (const line of VECTORS.trim().split("\n")) {
    const [kind, ...fields] = line.trim().split(" ")
    if (kind === "N") trees.push({ root: fields[2], leaves: [], proofs: [] })
    if (kind === "LEAF") {
        trees[trees.length - 1].leaves.push(fields[1])
        trees[trees.length - 1].proofs.push(fields[3] ?? "")
    }
    if (kind === "TRAIT") trait = fields[0]
}
const five = trees[4]

/** The allowlist behind the five leaves: stage 2 of collection C7, each address allowed its position plus one. */
const ALLOWLIST = [
    "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj",
    "g1manfred47kzduec920z88wfr64ylksmdcedlf5",
    "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2",
    "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0",
]
const [ALICE, , BOB] = ALLOWLIST
const MAX_INT64 = 9223372036854775807n

describe("on-chain vectors", () => {
    it("cover trees of one to five leaves", () => {
        expect(trees.map((tree) => tree.leaves.length)).toEqual([1, 2, 3, 4, 5])
        expect(trees.every((tree) => tree.proofs.length === tree.leaves.length)).toBe(true)
        expect(trees[0].proofs).toEqual([""])
    })

    it.each(trees)("reproduces the root of $leaves.length leaves", async ({ root, leaves }) => {
        await expect(merkleRoot(leaves)).resolves.toBe(root)
    })

    it.each(trees)("reproduces and verifies every proof of $leaves.length leaves", async ({ root, leaves, proofs }) => {
        for (const [index, leaf] of leaves.entries()) {
            await expect(merkleProof(leaves, index)).resolves.toBe(proofs[index])
            await expect(verifyProof(root, leaf, proofs[index])).resolves.toBe(true)
        }
    })

    it("reproduces the five allowlist leaves and the trait leaf", async () => {
        await expect(Promise.all(ALLOWLIST.map((who, position) => allowlistLeaf("C7", 2, who, BigInt(position + 1))))).resolves.toEqual(five.leaves)
        await expect(traitLeaf("C7", 12n, "Background=Blue")).resolves.toBe(trait)
    })

    it("reproduces the vector of the package's own unit test", async () => {
        const leaves = ["alpha", "bravo", "charlie"].map((data) => createHash("sha256").update(`\0${data}`).digest("hex"))
        expect(leaves[0]).toBe("2a158d8afd48e3f88cb4195dfdb2a9e4817d95fa57fd34440d93f9aae5c4f82b")
        await expect(merkleRoot(leaves)).resolves.toBe("d65c7ba72781632a72ee6032be54665f049844eedd81fa175a7821c02e633ed1")
        await expect(merkleProof(leaves, 2)).resolves.toBe("fb33dff7b9f27b94d57431d3c72e3268e5dda9c4de3d2b0d34ab34146d6e6806")
    })
})

describe("tree", () => {
    it("keeps the order of its leaves", async () => {
        const [a, b, c] = five.leaves
        await expect(merkleRoot([c, b, a])).resolves.not.toBe(trees[2].root)
    })

    it("does not verify a foreign leaf, another leaf's proof, a shortened proof or another root", async () => {
        const { root, leaves, proofs } = five
        await expect(verifyProof(root, trait, proofs[0])).resolves.toBe(false)
        await expect(verifyProof(root, leaves[0], proofs[2])).resolves.toBe(false)
        await expect(verifyProof(root, leaves[0], proofs[0].slice(0, 129))).resolves.toBe(false)
        await expect(verifyProof(root, leaves[0], "")).resolves.toBe(false)
        await expect(verifyProof(trees[3].root, leaves[0], proofs[0])).resolves.toBe(false)
    })

    it("refuses a proof longer than a realm accepts, and only that", async () => {
        const path = (length: number) => Array.from({ length }, () => trait).join(",")
        await expect(verifyProof(five.root, five.leaves[0], path(32))).resolves.toBe(false)
        await expect(verifyProof(five.root, five.leaves[0], path(33))).rejects.toThrow(/^Invalid proof$/)
    })

    it.each([
        ["an uppercase hash", trait.toUpperCase()],
        ["a short hash", trait.slice(1)],
        ["a hash with a 0x prefix", `0x${trait.slice(2)}`],
        ["a trailing comma", `${trait},`],
        ["a space after the comma", `${trait}, ${trait}`],
    ])("refuses a proof with %s", async (_name, proof) => {
        await expect(verifyProof(five.root, five.leaves[0], proof)).rejects.toThrow(/^Invalid proof$/)
    })

    it("refuses a malformed root or leaf, and a tree without leaves", async () => {
        await expect(verifyProof("root", five.leaves[0], "")).rejects.toThrow(/^Invalid root$/)
        await expect(verifyProof(five.root, five.leaves[0].toUpperCase(), "")).rejects.toThrow(/^Invalid leaf$/)
        await expect(merkleRoot([])).rejects.toThrow(/^No leaves$/)
        await expect(merkleRoot([five.leaves[0], "leaf"])).rejects.toThrow(/^Invalid leaf$/)
        await expect(merkleProof([five.leaves[0], ""], 0)).rejects.toThrow(/^Invalid leaf$/)
    })

    it.each([-1, 5, 0.5, Number.NaN])("refuses the leaf index %d", async (index) => {
        await expect(merkleProof(five.leaves, index)).rejects.toThrow(/^Invalid leaf index$/)
    })
})

describe("allowlist leaf", () => {
    it("binds the collection, the stage, the address and the allowance", async () => {
        const leaf = await allowlistLeaf("C7", 2, ALICE, 1n)
        for (const other of [allowlistLeaf("C8", 2, ALICE, 1n), allowlistLeaf("C7", 3, ALICE, 1n), allowlistLeaf("C7", 2, BOB, 1n), allowlistLeaf("C7", 2, ALICE, 2n)]) {
            await expect(other).resolves.not.toBe(leaf)
        }
        await expect(allowlistLeaf("C7", 0, ALICE, MAX_INT64)).resolves.toMatch(/^[0-9a-f]{64}$/)
    })

    it.each([
        ["a collection ID with a leading zero", "C07", 2, ALICE, 1n, "Invalid collection ID"],
        ["a collection ID in lowercase", "c7", 2, ALICE, 1n, "Invalid collection ID"],
        ["a collection ID carrying a separator", "C7|2", 2, ALICE, 1n, "Invalid collection ID"],
        ["a negative stage", "C7", -1, ALICE, 1n, "Invalid stage index"],
        ["a fractional stage", "C7", 1.5, ALICE, 1n, "Invalid stage index"],
        ["an address with a mistyped character", "C7", 2, `${ALICE.slice(0, -1)}6`, 1n, "Invalid address"],
        ["an address of the wrong length", "C7", 2, ALICE.slice(0, -1), 1n, "Invalid address"],
        ["an address in uppercase", "C7", 2, ALICE.toUpperCase(), 1n, "Invalid address"],
        ["an empty address", "C7", 2, "", 1n, "Invalid address"],
        ["no allowance", "C7", 2, ALICE, 0n, "Invalid allowance"],
        ["a negative allowance", "C7", 2, ALICE, -1n, "Invalid allowance"],
        ["an allowance beyond int64", "C7", 2, ALICE, MAX_INT64 + 1n, "Invalid allowance"],
    ])("refuses %s", async (_name, collection, stage, who, allowance, message) => {
        await expect(allowlistLeaf(collection, stage, who, allowance)).rejects.toThrow(new RegExp(`^${message}$`))
    })
})

describe("trait leaf", () => {
    it("takes a trait of at most 100 bytes", async () => {
        await expect(traitLeaf("C7", 12n, `k=${"é".repeat(49)}`)).resolves.toMatch(/^[0-9a-f]{64}$/)
        await expect(traitLeaf("C7", 12n, `k=${"é".repeat(50)}`)).rejects.toThrow(/^Invalid trait$/)
        await expect(traitLeaf("C7", 12n, `k=${"v".repeat(99)}`)).rejects.toThrow(/^Invalid trait$/)
    })

    it.each([
        ["without a separator", "Background"],
        ["without a type", "=Blue"],
        ["without a value", "Background="],
        ["with two separators", "Background=Blue=Dark"],
        ["carrying the leaf separator", "Background=Blue|C8"],
        ["left empty", ""],
    ])("refuses a trait %s", async (_name, value) => {
        await expect(traitLeaf("C7", 12n, value)).rejects.toThrow(/^Invalid trait$/)
    })

    it("refuses a malformed collection ID and a token number that is not positive", async () => {
        await expect(traitLeaf("7", 12n, "Background=Blue")).rejects.toThrow(/^Invalid collection ID$/)
        await expect(traitLeaf("C7", 0n, "Background=Blue")).rejects.toThrow(/^Invalid token number$/)
        await expect(traitLeaf("C7", MAX_INT64 + 1n, "Background=Blue")).rejects.toThrow(/^Invalid token number$/)
    })
})

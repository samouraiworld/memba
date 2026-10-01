import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { derivePkgBech32Addr } from "./dao/realmAddress"
import { prepareAirdropManifest, verifyAirdropManifest } from "./tokenLaunchpadAirdropManifest"

// The vector pinned in samcrew-deployer p/merkle/v1 TestAirdropManifestVector:
// the contract verifies exactly this root and these proofs.
const S = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const X = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const M = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const VECTOR_ROOT = "4e6949dc1f5852cb4157378a8aff450fc4340e8ad80a3dd8964947e0c8b93918"
const VECTOR_PROOFS = [
    "3ef927367e32c1ed21bb96714d6748b240e8b26eaa6f78500a309f710d49e7d1,c237bee5f0fc3b9299afc7905a555a284c658d5ec9237e7f54dae98b9648b0e0",
    "c28fe50e5d2a6ccb7d339cd2b518afd4457e82b7be778515955d5317e824dc58,c237bee5f0fc3b9299afc7905a555a284c658d5ec9237e7f54dae98b9648b0e0",
    "51ded75c3e8cb97bbd37e8853af6b2d9edf78655f8ab3ed24fab75184ee7997d",
]
const entries = [
    { index: 0, beneficiary: S, amount: "15" },
    { index: 1, beneficiary: X, amount: "20" },
    { index: 2, beneficiary: M, amount: "5" },
]

describe("Launchpad airdrop manifest", () => {
    it("reproduces the contract's vector: root, proofs and the promoted odd leaf", () => {
        const manifest = prepareAirdropManifest("T2", [entries[2], entries[0], entries[1]])
        expect(manifest).toEqual({
            tokenId: "T2", root: VECTOR_ROOT, total: "40",
            claims: entries.map((entry, i) => ({ ...entry, proof: VECTOR_PROOFS[i] })),
        })
        expect(verifyAirdropManifest(manifest, { tokenId: "T2", root: VECTOR_ROOT, total: "40" })).toEqual(manifest)
        const shuffled = { ...manifest, claims: [manifest.claims[2], manifest.claims[0], manifest.claims[1]] }
        expect(verifyAirdropManifest(shuffled, { tokenId: "T2", root: VECTOR_ROOT, total: "40" })).toEqual(manifest)
    })

    it("gives every leaf a proof that folds to the root, for trees of 1 to 33 leaves", () => {
        // An independent verifier, as p/merkle/v1 Verify: hash the leaf, then fold
        // each sibling in as 0x01 || the smaller hash || the larger one.
        const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
        const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!, b => parseInt(b, 16))
        const fold = (tokenId: string, claim: { index: number; beneficiary: string; amount: string; proof: string }) => {
            const text = new TextEncoder().encode(`launchpad-airdrop-v1|${tokenId}|${claim.index}|${claim.beneficiary}|${claim.amount}`)
            let node = sha256(Uint8Array.of(0, ...text))
            for (const sibling of claim.proof ? claim.proof.split(",").map(fromHex) : []) {
                const [a, b] = hex(node) <= hex(sibling) ? [node, sibling] : [sibling, node]
                node = sha256(Uint8Array.of(1, ...a, ...b))
            }
            return hex(node)
        }
        for (let n = 1; n <= 33; n++) {
            const manifest = prepareAirdropManifest("T9", Array.from({ length: n }, (_, i) => ({ index: i, beneficiary: [S, X, M][i % 3], amount: String(i + 1) })))
            for (const claim of manifest.claims) expect(fold("T9", claim), `n=${n} index=${claim.index}`).toBe(manifest.root)
        }
    })

    it("gives a one-leaf tree its leaf as root and an empty proof", () => {
        const one = prepareAirdropManifest("T2", [entries[0]])
        expect(one.claims[0].proof).toBe("")
        expect(one.root).toBe(VECTOR_PROOFS[1].split(",")[0])
        expect(one.total).toBe("15")
    })

    it("keeps int64 amounts exact and refuses a total past int64", () => {
        const max = "9223372036854775807"
        expect(prepareAirdropManifest("T2", [{ ...entries[0], amount: max }]).total).toBe(max)
        expect(() => prepareAirdropManifest("T2", [{ ...entries[0], amount: max }, entries[1]])).toThrow("total exceeds int64")
    })

    it("accepts an address only as the chain writes a caller's", () => {
        // Capitals, the bech32m checksum, and bech32m in capitals: the chain decodes
        // each to X, but a leaf naming one would pay a balance no caller can reach.
        for (const other of [X.toUpperCase(), "g1x7k4628w93a7wzdhqc06atzx0v50rnshm9v2ed", "G1X7K4628W93A7WZDHQC06ATZX0V50RNSHM9V2ED"]) {
            expect(() => prepareAirdropManifest("T2", [{ ...entries[1], index: 0, beneficiary: other }])).toThrow("as the chain writes it")
        }
        expect(() => prepareAirdropManifest("T2", [{ ...entries[1], index: 0, beneficiary: `${X.slice(0, -1)}q` }])).toThrow("beneficiary")
    })

    it("refuses the sales realm, which holds the airdropped tokens, as a beneficiary", async () => {
        const sales = await derivePkgBech32Addr("gno.land/r/samcrew/launchpad/sales/v1")
        expect(sales).toBe("g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53")
        expect(() => prepareAirdropManifest("T2", [{ ...entries[0], beneficiary: sales }])).toThrow("not the sales realm")
    })

    it("refuses bad token IDs, indices and amounts before hashing", () => {
        expect(() => prepareAirdropManifest("T0", entries)).toThrow("token ID")
        expect(() => prepareAirdropManifest("T2", [])).toThrow("entry count")
        expect(() => prepareAirdropManifest("T2", [entries[0], entries[0]])).toThrow("indices")
        expect(() => prepareAirdropManifest("T2", [entries[1]])).toThrow("indices")
        expect(() => prepareAirdropManifest("T2", [{ ...entries[0], index: -1 }])).toThrow("leaf index")
        expect(() => prepareAirdropManifest("T2", [{ ...entries[0], index: -0 }])).toThrow("leaf index")
        for (const amount of ["0", "-0", "015", "1.5", "-1", "9".repeat(100_000)]) {
            expect(() => prepareAirdropManifest("T2", [{ ...entries[0], amount }])).toThrow("canonical positive decimal")
        }
        expect(() => prepareAirdropManifest("T2", [{ ...entries[0], amount: "9223372036854775808" }])).toThrow("amount exceeds int64")
    })

    it("refuses a published manifest that differs from the chain or from its own proofs", () => {
        const manifest = prepareAirdropManifest("T2", entries)
        const commitment = { tokenId: "T2", root: VECTOR_ROOT, total: "40" }
        expect(() => verifyAirdropManifest(manifest, { ...commitment, total: "41" })).toThrow("chain commitment")
        expect(() => verifyAirdropManifest(manifest, { ...commitment, tokenId: "T3" })).toThrow("chain commitment")
        expect(() => verifyAirdropManifest(manifest, { ...commitment, root: "0".repeat(64) })).toThrow("chain commitment")
        const swapped = { ...manifest, claims: [{ ...manifest.claims[0], proof: VECTOR_PROOFS[1] }, ...manifest.claims.slice(1)] }
        expect(() => verifyAirdropManifest(swapped, commitment)).toThrow("root, total or proofs")
        const inflated = { ...manifest, claims: [{ ...manifest.claims[0], amount: "16" }, ...manifest.claims.slice(1)] }
        expect(() => verifyAirdropManifest(inflated, commitment)).toThrow("root, total or proofs")
        // A campaign funded with more than its leaves add up to leaves tokens no proof can claim.
        expect(() => verifyAirdropManifest({ ...manifest, total: "41" }, { ...commitment, total: "41" })).toThrow("root, total or proofs")
    })
})

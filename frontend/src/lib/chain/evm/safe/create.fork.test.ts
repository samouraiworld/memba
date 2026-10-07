/**
 * Creating a Safe on a fork of Base Sepolia with Memba's own planNewSafe and
 * deployNewSafe (real protocol-kit, a wagmi wallet on an anvil account): the
 * Safe lands at the predicted address and is read back from the chain.
 *
 * Runs only with MEMBA_EVM_FORK_RPC set to an anvil fork, e.g.
 *   anvil --fork-url https://sepolia.base.org --port 8547
 *   MEMBA_EVM_FORK_RPC=http://127.0.0.1:8547 node ./node_modules/.bin/vitest run src/lib/chain/evm/safe/create.fork.test.ts
 */
import { describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import { deployNewSafe, planNewSafe } from "./create"
import { ANVIL, FORK, connectWallet } from "../../../../test/evmForkWallet"

vi.mock("../adapter", async () => (await import("../../../../test/evmForkWallet")).forkAdapter)

describe.skipIf(!FORK)("creating a Safe on a Base Sepolia fork", () => {
    it("plans, deploys and confirms exactly the SafeL2 1.5.0 asked for, at the predicted address", async () => {
        const deployer = ANVIL[4]
        await connectWallet(deployer)
        const owners: Hex[] = [ANVIL[4], "0xb0b0000000000000000000000000000000000002", "0xca1e000000000000000000000000000000000003"]
        const plan = await planNewSafe("base-sepolia", owners, 2)
        expect(plan.chainId).toBe(84532)
        const sent = vi.fn()
        const { hash, safe } = await deployNewSafe("base-sepolia", plan, sent)
        expect(sent).toHaveBeenCalledWith(hash)
        expect(safe).toMatchObject({ address: plan.predicted, version: "1.5.0", l2: true, threshold: 2, nonce: 0n, modules: [], guard: null, warnings: [] })
        expect([...safe.owners].sort()).toEqual([...owners].sort())
        // The same plan can't be deployed twice: the address now holds the Safe.
        await expect(planNewSafe("base-sepolia", owners, 2, plan.saltNonce)).rejects.toMatchObject({ reason: { code: "address-taken" } })
    }, 120_000)
})

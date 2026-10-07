/**
 * Creating a Safe on a fork of Base Sepolia, with protocol-kit itself (no mock):
 * the deployment it builds passes Memba's check, the predicted address is where
 * the Safe lands, and the chain inspection reads back exactly the Safe asked for.
 *
 * Runs only with MEMBA_EVM_FORK_RPC set to an anvil fork, e.g.
 *   anvil --fork-url https://sepolia.base.org --port 8547
 *   MEMBA_EVM_FORK_RPC=http://127.0.0.1:8547 node ./node_modules/.bin/vitest run src/lib/chain/evm/safe/create.fork.test.ts
 */
import { describe, expect, it } from "vitest"
import Safe from "@safe-global/protocol-kit"
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { assertDeployment, newSafeConfig, randomSalt } from "./create"
import { inspectSafe, type SafeReader } from "./inspect"

const FORK = process.env.MEMBA_EVM_FORK_RPC
// anvil's first default account (a public test key, funded on every anvil fork).
const DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex

describe.skipIf(!FORK)("creating a Safe on a Base Sepolia fork", () => {
    it("deploys exactly the SafeL2 1.5.0 Memba asked for, at the predicted address", async () => {
        const account = privateKeyToAccount(DEPLOYER)
        const publicClient = createPublicClient({ chain: baseSepolia, transport: http(FORK) })
        const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(FORK) })
        const owners: Hex[] = [account.address.toLowerCase() as Hex, "0xb0b0000000000000000000000000000000000002", "0xca1e000000000000000000000000000000000003"]
        const salt = randomSalt()

        const kit = await Safe.init({ provider: FORK!, signer: DEPLOYER, predictedSafe: newSafeConfig(owners, 2, salt), isL1SafeSingleton: false })
        const predicted = (await kit.getAddress()).toLowerCase() as Hex
        const deployment = await kit.createSafeDeploymentTransaction()
        expect(() => assertDeployment(deployment, owners, 2, salt)).not.toThrow()
        expect(await publicClient.getCode({ address: predicted })).toBeUndefined()

        const hash = await wallet.sendTransaction({ to: deployment.to as Hex, data: deployment.data as Hex, value: BigInt(deployment.value) })
        expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success")

        const reader: SafeReader = {
            getChainId: () => publicClient.getChainId(),
            getCode: (address) => publicClient.getCode({ address }),
            getStorageAt: (address, slot) => publicClient.getStorageAt({ address, slot }),
            call: async (to, data) => (await publicClient.call({ to, data })).data ?? "0x",
        }
        const inspection = await inspectSafe(reader, keccak256, baseSepolia.id, predicted)
        expect(inspection).toMatchObject({
            kind: "ok",
            value: { kind: "safe", address: predicted, version: "1.5.0", l2: true, threshold: 2, nonce: 0n, modules: [], guard: null, warnings: [] },
        })
        if (inspection.kind === "ok" && inspection.value.kind === "safe") expect([...inspection.value.owners].sort()).toEqual([...owners].sort())
    }, 120_000)
})

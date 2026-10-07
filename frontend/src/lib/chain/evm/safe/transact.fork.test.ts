/**
 * Proposing, signing and executing on a fork of Base Sepolia, with protocol-kit
 * itself (no mock; the Transaction Service is not on the fork, so signatures
 * are passed by hand): what protocol-kit builds passes Memba's check, its hash
 * is Memba's own, both owners' EIP-712 signatures are recovered by Memba's
 * verifier, and the Safe executes a single payment and a call-only batch.
 *
 * Runs only with MEMBA_EVM_FORK_RPC set to an anvil fork, e.g.
 *   anvil --fork-url https://sepolia.base.org --port 8547
 *   MEMBA_EVM_FORK_RPC=http://127.0.0.1:8547 node ./node_modules/.bin/vitest run src/lib/chain/evm/safe/transact.fork.test.ts
 */
import { describe, expect, it } from "vitest"
import Safe from "@safe-global/protocol-kit"
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { newSafeConfig, randomSalt } from "./create"
import { assertBuilt, type SafeCall } from "./transact"
import { checkQueuedTx, safeTxHash } from "./verify"

const FORK = process.env.MEMBA_EVM_FORK_RPC
// anvil's default accounts 0-2 (public test keys, funded on every anvil fork).
const KEYS: Hex[] = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
]

describe.skipIf(!FORK)("Safe transactions on a Base Sepolia fork", () => {
    it("proposes, signs (2 of 3, EIP-712) and executes a payment and a call-only batch", async () => {
        const [a, b, c] = KEYS.map((k) => privateKeyToAccount(k))
        const owners = [a, b, c].map((x) => x.address.toLowerCase() as Hex)
        const publicClient = createPublicClient({ chain: baseSepolia, transport: http(FORK) })
        const funder = createWalletClient({ account: a, chain: baseSepolia, transport: http(FORK) })

        // A fresh 2-of-3, funded with 1 ETH.
        const creator = await Safe.init({ provider: FORK!, signer: KEYS[0], predictedSafe: newSafeConfig(owners, 2, randomSalt()), isL1SafeSingleton: false })
        const safe = (await creator.getAddress()).toLowerCase() as Hex
        const deploy = await creator.createSafeDeploymentTransaction()
        await publicClient.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: deploy.to as Hex, data: deploy.data as Hex }) })
        await publicClient.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: safe, value: parseEther("1") }) })

        const payee1: Hex = "0x1111111111111111111111111111111111111111"
        const payee2: Hex = "0x2222222222222222222222222222222222222222"
        for (const calls of [
            [{ to: payee1, value: parseEther("0.1"), data: "0x" }],
            [{ to: payee1, value: parseEther("0.2"), data: "0x" }, { to: payee2, value: parseEther("0.3"), data: "0x" }],
        ] as SafeCall[][]) {
            const kitA = await Safe.init({ provider: FORK!, signer: KEYS[0], safeAddress: safe })
            const nonce = Number(await kitA.getNonce())
            const tx = await kitA.createTransaction({ transactions: calls.map((x) => ({ to: x.to, value: x.value.toString(), data: x.data, operation: 0 })), onlyCalls: true, options: { nonce } })
            expect(() => assertBuilt(tx.data, calls)).not.toThrow()
            const hash = (await kitA.getTransactionHash(tx)).toLowerCase()
            expect(hash).toBe(safeTxHash(baseSepolia.id, { ...tx.data, safe, safeTxHash: "" }))

            const sigA = (await kitA.signTransaction(tx, "eth_signTypedData_v4")).getSignature(owners[0])!.data
            const kitB = await Safe.init({ provider: FORK!, signer: KEYS[1], safeAddress: safe })
            const sigB = (await kitB.signTransaction(tx, "eth_signTypedData_v4")).getSignature(owners[1])!.data
            const check = await checkQueuedTx(baseSepolia.id, owners, { ...tx.data, safe, safeTxHash: hash, confirmations: [{ owner: owners[0], signature: sigA }, { owner: owners[1], signature: sigB }] })
            expect(check.hashMatches).toBe(true)
            expect([...check.verified].sort()).toEqual([owners[0], owners[1]].sort())

            const before = await Promise.all(calls.map((x) => publicClient.getBalance({ address: x.to })))
            const signedTx = await kitB.signTransaction(await kitA.signTransaction(tx, "eth_signTypedData_v4"), "eth_signTypedData_v4")
            const result = await kitA.executeTransaction(signedTx)
            expect((await publicClient.waitForTransactionReceipt({ hash: result.hash as Hex })).status).toBe("success")
            const after = await Promise.all(calls.map((x) => publicClient.getBalance({ address: x.to })))
            calls.forEach((x, i) => expect(after[i] - before[i]).toBe(x.value))
            expect(await kitA.getNonce()).toBe(nonce + 1)
        }
    }, 180_000)
})

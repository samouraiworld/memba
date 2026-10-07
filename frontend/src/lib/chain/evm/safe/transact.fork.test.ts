/**
 * Proposing, signing and executing on a fork of Base Sepolia through Memba's
 * own proposeSafeTx / confirmSafeTx / executeSafeTx (real protocol-kit, wagmi
 * wallets on anvil accounts; the Transaction Service is an in-memory stand-in,
 * since it doesn't index the fork).
 *
 * Also the regression for the gas-refund drain: a queued "send 1 wei" whose
 * baseGas, gasPrice and refundReceiver pay an attacker from the Safe. Memba
 * refuses to sign or execute it; executed directly, it does drain the Safe.
 *
 * Runs only with MEMBA_EVM_FORK_RPC set to an anvil fork, e.g.
 *   anvil --fork-url https://sepolia.base.org --port 8547
 *   MEMBA_EVM_FORK_RPC=http://127.0.0.1:8547 node ./node_modules/.bin/vitest run src/lib/chain/evm/safe/transact.fork.test.ts
 */
import { describe, expect, it, vi } from "vitest"
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { ANVIL, FORK, connectWallet } from "../../../../test/evmForkWallet"
import { deployNewSafe, planNewSafe, SafeActionError } from "./create"
import { decodeSafeTx, gasRefund } from "./decode"
import { confirmSafeTx, executeSafeTx, proposeSafeTx } from "./transact"
import { safeTxHash, safeTxTypedData } from "./verify"

vi.mock("../adapter", async () => (await import("../../../../test/evmForkWallet")).forkAdapter)

interface Listed { safe: string; safeTxHash: string; confirmations: { owner: string; signature: string }[]; [k: string]: unknown }
const store = new Map<string, Listed>()
const fakeService = {
    getNextNonce: async (safe: string) => String([...store.values()].filter((t) => t.safe.toLowerCase() === safe.toLowerCase()).reduce((n, t) => Math.max(n, Number(t.nonce) + 1), 0)),
    proposeTransaction: async (p: { safeAddress: string; safeTransactionData: Record<string, unknown>; safeTxHash: string; senderAddress: string; senderSignature: string }) => {
        store.set(p.safeTxHash.toLowerCase(), { ...p.safeTransactionData, safe: p.safeAddress, safeTxHash: p.safeTxHash, confirmations: [{ owner: p.senderAddress, signature: p.senderSignature }] })
    },
    getTransaction: async (hash: string) => {
        const t = store.get(hash.toLowerCase())
        if (!t) throw new Error("Not found.")
        return t
    },
    confirmTransaction: async (hash: string, signature: string) => {
        store.get(hash.toLowerCase())!.confirmations.push({ owner: "", signature })
    },
}
vi.mock("./txService", () => ({ safeApiKit: () => fakeService }))

// anvil's default keys for accounts 0-2 (public test keys).
const KEYS: Hex[] = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
]
const [A, B, C] = ANVIL
const API = "https://api.test"
const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const EXEC_ABI = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)"])

/** confirmTransaction carries no owner: the stand-in records the signer the way the real service does. */
async function confirmAs(owner: Hex, safe: Hex, hash: Hex) {
    await connectWallet(owner)
    await confirmSafeTx("base-sepolia", API, safe, hash)
    const c = store.get(hash)!.confirmations
    c[c.length - 1].owner = owner
}

describe.skipIf(!FORK)("Safe transactions on a Base Sepolia fork, through Memba's own code", () => {
    it("proposes, confirms and executes a payment and a call-only batch; refuses the gas-refund drain", async () => {
        const chain = createPublicClient({ chain: baseSepolia, transport: http(FORK) })
        const funder = createWalletClient({ account: privateKeyToAccount(KEYS[0]), chain: baseSepolia, transport: http(FORK) })
        await connectWallet(A)
        const plan = await planNewSafe("base-sepolia", [A, B, C], 2)
        const { safe: created } = await deployNewSafe("base-sepolia", plan)
        const safe = created.address
        await chain.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: safe, value: parseEther("5") }) })
        const payee1: Hex = "0x1111111111111111111111111111111111111111", payee2: Hex = "0x2222222222222222222222222222222222222222"
        const before = async () => Promise.all([payee1, payee2].map((a) => chain.getBalance({ address: a })))

        // 1. One payment: A proposes, B confirms, C (an owner who hasn't signed) executes with the two signatures.
        let start = await before()
        await connectWallet(A)
        const h1 = await proposeSafeTx("base-sepolia", API, safe, [{ to: payee1, value: parseEther("0.1"), data: "0x" }])
        await confirmAs(B, safe, h1)
        await connectWallet(C)
        await executeSafeTx("base-sepolia", API, safe, h1)
        expect((await before())[0] - start[0]).toBe(parseEther("0.1"))

        // 2. A batch: A proposes; B executes without having signed (B's approval comes with the send).
        start = await before()
        await connectWallet(A)
        const h2 = await proposeSafeTx("base-sepolia", API, safe, [{ to: payee1, value: parseEther("0.2"), data: "0x" }, { to: payee2, value: parseEther("0.3"), data: "0x" }])
        await connectWallet(B)
        await executeSafeTx("base-sepolia", API, safe, h2)
        const after = await before()
        expect(after[0] - start[0]).toBe(parseEther("0.2"))
        expect(after[1] - start[1]).toBe(parseEther("0.3"))
        expect(await chain.readContract({ address: safe, abi: parseAbi(["function nonce() view returns (uint256)"]), functionName: "nonce" })).toBe(2n)

        // 3. The drain: "send 1 wei", but baseGas 3.9M at 1000 gwei paid to an attacker. Two owners' valid signatures.
        // A fresh attacker each run: the fork keeps its state between runs.
        const attacker = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex
        const drain = { to: payee1, value: "1", data: "0x", operation: 0, safeTxGas: "0", baseGas: "3900000", gasPrice: "1000000000000", gasToken: ZERO, refundReceiver: attacker, nonce: "2" }
        const hash = safeTxHash(baseSepolia.id, { ...drain, safe })
        const sig = (k: Hex) => privateKeyToAccount(k).signTypedData(safeTxTypedData(baseSepolia.id, { ...drain, safe }))
        store.set(hash, { ...drain, safe, safeTxHash: hash, confirmations: [{ owner: A, signature: await sig(KEYS[0]) }, { owner: B, signature: await sig(KEYS[1]) }] })

        // It reads as a harmless payment; the refund check is what catches it.
        expect(decodeSafeTx(safe, drain)).toMatchObject({ kind: "native-transfer", severity: "normal" })
        expect(gasRefund(drain)).toMatch(new RegExp(`payment to ${attacker}`))
        await connectWallet(C)
        await expect(confirmSafeTx("base-sepolia", API, safe, hash)).rejects.toBeInstanceOf(SafeActionError)
        for (const executor of [A, C]) {
            await connectWallet(executor)
            await expect(executeSafeTx("base-sepolia", API, safe, hash)).rejects.toMatchObject({ reason: { code: "unexpected-transaction" } })
        }
        expect(await chain.getBalance({ address: attacker })).toBe(0n)

        // The control: executed directly (at a 1000 gwei network price: the Safe pays the lower of its
        // gasPrice and the transaction's), the same signed transaction pays the attacker ~3.9 ETH from the Safe.
        const sorted = [[A, await sig(KEYS[0])], [B, await sig(KEYS[1])]].sort(([x], [y]) => (BigInt(x) < BigInt(y) ? -1 : 1))
        const data = encodeFunctionData({ abi: EXEC_ABI, functionName: "execTransaction", args: [payee1, 1n, "0x", 0, 0n, 3_900_000n, 1_000_000_000_000n, ZERO, attacker, `0x${sorted.map(([, s]) => s.slice(2)).join("")}`] })
        await chain.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: safe, data, gasPrice: 1_000_000_000_000n }) })
        expect(await chain.getBalance({ address: attacker })).toBeGreaterThan(parseEther("3.8"))
    }, 240_000)
})

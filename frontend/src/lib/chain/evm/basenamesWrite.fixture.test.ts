import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { Address } from "viem"
import { planBasenameRegistration, planBasenameTextUpdate } from "./basenamesWrite"
import { evmContract } from "./manifest"

/**
 * Golden calldata shared with Foundry: this test encodes the Profile writes, and
 * contracts/evm/test/fork/BasenamesFixture.t.sol EXECUTES the same bytes on both forks (register with records and
 * primary name, ENSIP-19 setName, owner multicall). The ABI-to-contract match is therefore checked by the deployed
 * contracts, not by this module's own ABI. Regenerate after an intended change with
 * `UPDATE_EVM_FIXTURES=1 node ./node_modules/.bin/vitest run src/lib/chain/evm/basenamesWrite.fixture.test.ts`.
 */
const DIR = resolve(__dirname, "../../../../../contracts/evm/test/fixtures")
const ALICE: Address = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" // vm.addr(0xA11CE) in ForkBase
const LABEL = "membagoldenfixture"
const PRICE = 99_908_791_632_000n // registerPrice(LABEL, 1 year) at both pinned fork blocks

function fixture(chainId: number) {
    const suffix = chainId === 8453 ? ".base.eth" : ".basetest.eth"
    const plan = planBasenameRegistration({
        account: ALICE,
        quote: { chainId, account: ALICE, label: LABEL, years: 1, available: true, price: PRICE, ensip19Primary: `membaoldname${suffix}` },
        texts: { description: "Memba builder", "memba.profile.v1": '{"version":1}' },
    })
    const update = planBasenameTextUpdate(chainId, ALICE, { name: plan.name, node: plan.node, resolver: evmContract(chainId, "basenamesL2Resolver") }, {
        url: "https://memba.club",
        description: "",
    })
    return {
        chainId,
        account: ALICE,
        label: LABEL,
        name: plan.name,
        node: plan.node,
        price: PRICE.toString(),
        register: { to: plan.steps[0].write.to, value: plan.steps[0].write.value.toString(), data: plan.steps[0].write.data },
        setName: { to: plan.steps[1]!.write.to, data: plan.steps[1]!.write.data },
        update: { to: update.to, data: update.data },
    }
}

describe("golden Basenames calldata (executed by Foundry)", () => {
    for (const chainId of [8453, 84532]) {
        it(`matches contracts/evm/test/fixtures/basenames-${chainId}.json`, () => {
            const file = join(DIR, `basenames-${chainId}.json`)
            const next = `${JSON.stringify(fixture(chainId), null, 2)}\n`
            if (process.env.UPDATE_EVM_FIXTURES === "1") writeFileSync(file, next)
            expect(existsSync(file), `${file} missing: regenerate it`).toBe(true)
            expect(readFileSync(file, "utf8")).toBe(next)
        })
    }
})

import { describe, expect, it, vi } from "vitest"
import { parseOsPath } from "./osPath"

vi.mock("../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const SAFE = "0x5aFE5afe5aFe5afE5afE5aFE5AfE5afe5aFe5AFE"

describe("parseOsPath in an EVM build", () => {
    it("reads a Safe by its address, kept lowercase", () => {
        expect(parseOsPath(`/os/multisig/${SAFE}`)).toEqual({ kind: "multisig", address: SAFE.toLowerCase() })
    })

    it("refuses a partial EVM address or one with more after it", () => {
        expect(parseOsPath(`/os/multisig/${SAFE.slice(0, 20)}`).kind).toBe("unknown")
        expect(parseOsPath(`/os/multisig/${SAFE}/propose`).kind).not.toBe("multisig")
    })
})

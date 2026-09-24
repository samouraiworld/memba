import { describe, it, expect, vi, beforeEach } from "vitest"
import { create } from "@bufbuild/protobuf"
import { AttestationVoucherSchema } from "../gen/memba/v1/memba_pb"

// Pin the active network to mainnet for the allowlist gate, whatever the env,
// and stub the qeval read.
vi.mock("./config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./config")>()
    return { ...actual, isRealmValid: (p: string) => actual.isRealmValidOn("mainnet", p) }
})
const queryEval = vi.fn()
vi.mock("./dao/shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./dao/shared")>()),
    queryEval: (...a: unknown[]) => queryEval(...a),
}))

const {
    parseGoString,
    buildRecordCompletionMsg,
    fetchRealmSignerHex,
    isAttestationClaimable,
    RECORD_COMPLETION_GAS_WANTED,
    RECORD_COMPLETION_MAX_DEPOSIT_UGNOT,
} = await import("./attestation")

const REALM = "gno.land/r/samcrew/memba_quest_attestation_v1"
const KEY = "4dbf5a291e6a363780a1dfe75671562d894240f4c138129f336116a2adc795ba"

describe("parseGoString", () => {
    it("unwraps a gno string qeval result", () => {
        expect(parseGoString(`("connect-wallet,use-cmdk" string)`)).toBe("connect-wallet,use-cmdk")
    })
    it("handles an empty string result", () => {
        expect(parseGoString(`("" string)`)).toBe("")
    })
    it("falls back to the trimmed raw value when unwrapped", () => {
        expect(parseGoString("  raw  ")).toBe("raw")
    })
})

describe("buildRecordCompletionMsg", () => {
    it("builds a vm/MsgCall with args in the realm's order (addr, questId, xp, nonce, sig)", () => {
        const v = create(AttestationVoucherSchema, {
            questId: "connect-wallet", xp: 10, nonce: "abc123", sigHex: "deadbeef",
        })
        const msg = buildRecordCompletionMsg("g1alice", "gno.land/r/samcrew/memba_quest_attestation_v1", v)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toMatchObject({
            caller: "g1alice",
            pkg_path: "gno.land/r/samcrew/memba_quest_attestation_v1",
            func: "RecordCompletion",
            args: ["g1alice", "connect-wallet", "10", "abc123", "deadbeef"],
        })
    })

    it("stringifies xp (the realm's xp param is an int, gnokey passes string args)", () => {
        const v = create(AttestationVoucherSchema, { questId: "q", xp: 350, nonce: "n", sigHex: "s" })
        const msg = buildRecordCompletionMsg("g1bob", "realm", v)
        expect((msg.value.args as string[])[2]).toBe("350")
    })
})

describe("RecordCompletion sizing", () => {
    it("caps the storage deposit on every call (mainnet otherwise allows up to 100 GNOT)", () => {
        const v = create(AttestationVoucherSchema, { questId: "q", xp: 10, nonce: "n", sigHex: "s" })
        const msg = buildRecordCompletionMsg("g1alice", REALM, v)
        expect(msg.value.max_deposit).toBe("1600000ugnot")
        expect(msg.value.send).toBe("")
    })

    it("covers the measured worst case with margin", () => {
        // 6,654 B was the largest delta measured (first attestation for a user,
        // 16,000 entries per tree), at 100 ugnot per byte.
        expect(RECORD_COMPLETION_MAX_DEPOSIT_UGNOT).toBeGreaterThanOrEqual(2 * 6_654 * 100)
        // 24.9M gas was the largest measured; the 10M profile default runs out.
        expect(RECORD_COMPLETION_GAS_WANTED).toBeGreaterThanOrEqual(2 * 24_875_422)
        expect(RECORD_COMPLETION_GAS_WANTED).toBeLessThanOrEqual(500_000_000)
    })
})

describe("fetchRealmSignerHex", () => {
    beforeEach(() => queryEval.mockReset())

    it("reads GetSigner() from the given realm and lowercases it", async () => {
        queryEval.mockResolvedValue(`("${KEY.toUpperCase()}" string)`)
        await expect(fetchRealmSignerHex(REALM)).resolves.toBe(KEY)
        expect(queryEval).toHaveBeenCalledWith(expect.any(String), REALM, "GetSigner()")
    })

    it("is empty when the signer is unset or the read fails", async () => {
        queryEval.mockResolvedValue(`("" string)`)
        await expect(fetchRealmSignerHex(REALM)).resolves.toBe("")
        queryEval.mockRejectedValueOnce(new Error("rpc down"))
        await expect(fetchRealmSignerHex(REALM)).resolves.toBe("")
        await expect(fetchRealmSignerHex("")).resolves.toBe("")
    })
})

describe("isAttestationClaimable", () => {
    const state = (realmPath: string, signerPubkeyHex: string) => ({ vouchers: [], realmPath, signerPubkeyHex })

    it("is true on mainnet when the realm holds the backend's key", () => {
        expect(isAttestationClaimable(state(REALM, KEY), KEY)).toBe(true)
        expect(isAttestationClaimable(state(REALM, KEY.toUpperCase()), KEY)).toBe(true)
    })

    it("is false when the realm's signer is not the backend's key", () => {
        expect(isAttestationClaimable(state(REALM, KEY), "")).toBe(false)
        expect(isAttestationClaimable(state(REALM, KEY), "ab".repeat(32))).toBe(false)
        expect(isAttestationClaimable(state(REALM, ""), "")).toBe(false)
    })

    it("is false for a realm that is not allowlisted on the active network", () => {
        expect(isAttestationClaimable(state("gno.land/r/samcrew/memba_arcade_leaderboard_v1", KEY), KEY)).toBe(false)
        expect(isAttestationClaimable(state("", KEY), KEY)).toBe(false)
    })
})

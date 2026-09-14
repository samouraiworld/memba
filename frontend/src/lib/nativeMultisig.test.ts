import { describe, expect, it } from "vitest"
import { createNativeMultisig, memberAddress, nativeAddress, nativePreimage, parseNativeMultisig } from "./nativeMultisig"
import { pubkeyToAddress } from "./dao/realmAddress"

const hexKeys = ["0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"]
const keys = hexKeys.map(hex => btoa(String.fromCharCode(...hex.match(/../g)!.map(v => parseInt(v, 16)))))
const addresses = ["g1w508d6qejxtdg4y5r3zarvary0c5xw7kfptewu", "g1q6hag67dl53wl99vzg42z8eyzfz2xlkvrl6lhg"]
const raw = JSON.stringify({ "@type": "/tm.PubKeyMultisig", threshold: "2", pubkeys: keys.map(value => ({ "@type": "/tm.PubKeySecp256k1", value })) })

describe("native Gno identity (pinned node vectors)", () => {
    it("matches native bytes, member addresses and exact-order multisig address", async () => {
        const pk = parseNativeMultisig(raw)
        expect(nativeAddress(pk)).toBe("g14sngp6hjx9jchqk4pmkqrkesdklhwpd43q5vur")
        expect(Array.from(nativePreimage(pk), b => b.toString(16).padStart(2, "0")).join("")).toBe("0a122f746d2e5075624b65794d756c7469736967127a0802123a0a132f746d2e5075624b6579536563703235366b3112230a210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798123a0a132f746d2e5075624b6579536563703235366b3112230a2102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5")
        for (let i = 0; i < keys.length; i++) {
            expect(memberAddress(keys[i])).toBe(addresses[i])
            expect(await pubkeyToAddress(keys[i])).toBe(addresses[i])
        }
        expect(nativeAddress(pk)).not.toBe("g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l")
    })
    it("sorts only NEW creation by raw member address, never imports", () => {
        const imported = parseNativeMultisig(raw)
        const created = createNativeMultisig(keys.map((pubkeyValue, i) => ({ address: addresses[i], pubkeyValue })), 2)
        expect(created.pubkeys.map(p => p.value)).toEqual([...keys].reverse())
        expect(imported.pubkeys.map(p => p.value)).toEqual(keys)
        expect(nativeAddress(created)).not.toBe(nativeAddress(imported))
    })
    it("rejects mismatched labels, duplicate keys, malformed points and thresholds", () => {
        expect(() => createNativeMultisig(keys.map(pubkeyValue => ({ address: addresses[0], pubkeyValue })), 2)).toThrow()
        expect(() => createNativeMultisig([{ address: addresses[0], pubkeyValue: keys[0] }, { address: addresses[0], pubkeyValue: keys[0] }], 2)).toThrow()
        for (const threshold of ["0", "3", "02", "1.5"]) expect(() => parseNativeMultisig(raw.replace('"2"', JSON.stringify(threshold)))).toThrow()
        expect(() => memberAddress(btoa("a".repeat(33)))).toThrow()
        expect(() => parseNativeMultisig(raw.replace('"threshold"', '"extra":1,"threshold"'))).toThrow()
    })
})

import { describe, it, expect } from "vitest"
import {
    buildCreatePostMsg,
    buildEditPostMsg,
    buildDeletePostMsg,
    buildFlagPostMsg,
    FEED_PKG_PATH,
} from "./feed"
import { toAdenaMessages } from "./grc20"

// The feed builders MUST emit the Amino "vm/MsgCall" type — toAdenaMessages
// (the shared broadcast path) hard-throws on any other type, so a wrong type
// silently breaks every feed write. (This is the exact regression that bit the
// token OTC lane, which had no such test.) Each case round-trips through
// toAdenaMessages so the wire contract is pinned, not just the literal.

const caller = "g1caller"

describe("feed builders — Amino wire contract", () => {
    it("buildCreatePostMsg: CreatePost(body, replyTo) as a vm/MsgCall, no coins", () => {
        const msg = buildCreatePostMsg(caller, "gm", 0)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toMatchObject({
            caller,
            send: "",
            pkg_path: FEED_PKG_PATH,
            func: "CreatePost",
            args: ["gm", "0"],
        })
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })

    it("buildCreatePostMsg: replyTo is stringified", () => {
        expect(buildCreatePostMsg(caller, "re", 42).value.args).toEqual(["re", "42"])
    })

    it("buildEditPostMsg: EditPost(id, body)", () => {
        const msg = buildEditPostMsg(caller, 7n, "edited")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("EditPost")
        expect(msg.value.args).toEqual(["7", "edited"])
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })

    it("buildDeletePostMsg: DeletePost(id)", () => {
        const msg = buildDeletePostMsg(caller, 9n)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("DeletePost")
        expect(msg.value.args).toEqual(["9"])
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })

    it("buildFlagPostMsg: FlagPost(id)", () => {
        const msg = buildFlagPostMsg(caller, 3n)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("FlagPost")
        expect(msg.value.args).toEqual(["3"])
        expect(msg.value.send).toBe("")
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })
})

/**
 * Unit tests for boardTemplate.ts — Board realm code generator + MsgCall builders.
 */
import { describe, it, expect } from "vitest"
import {
    generateBoardCode,
    defaultBoardConfig,
    buildDeployBoardMsg,
    buildCreateThreadMsg,
    buildReplyToThreadMsg,
    buildCreateChannelMsg,
} from "./boardTemplate"

// ── defaultBoardConfig ────────────────────────────────────────

describe("defaultBoardConfig", () => {
    it("generates correct board realm path from DAO path", () => {
        const cfg = defaultBoardConfig("gno.land/r/user/mydao", "MyDAO")
        expect(cfg.boardRealmPath).toBe("gno.land/r/user/mydao_board")
        expect(cfg.name).toBe("MyDAO Board")
        expect(cfg.channels).toEqual(["general"])
        expect(cfg.minPostInterval).toBe(5)
    })
})

// ── generateBoardCode ─────────────────────────────────────────

describe("generateBoardCode", () => {
    const config = defaultBoardConfig("gno.land/r/user/mydao", "MyDAO")

    it("generates valid package declaration", () => {
        const code = generateBoardCode(config)
        expect(code).toContain('package mydao_board')
    })

    it("imports std for address, height, and caller", () => {
        const code = generateBoardCode(config)
        expect(code).toContain('"chain/runtime"')
        expect(code).not.toContain('"std"')
    })

    it("generates Thread and Reply types", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("type Thread struct")
        expect(code).toContain("type Reply struct")
        expect(code).toContain("type Channel struct")
    })

    it("auto-creates #general channel in init", () => {
        const code = generateBoardCode(config)
        expect(code).toContain('Channel{Name: "general"')
    })

    it("includes rate limiting with configured interval", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("minPostInterval  = 5")
        expect(code).toContain("assertCanPost")
        expect(code).toContain("assertCanPost")
    })

    it("generates CreateThread function with membership check", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func CreateThread(cur realm,")
        expect(code).toContain("runtime.PreviousRealm().Address()")
        expect(code).toContain("assertIsMember(caller)")
    })

    it("generates assertIsMember guard function (RT-H1 fix)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func assertIsMember(addr address)")
        expect(code).toContain("adminAddr")
    })

    it("generates assertIsAdmin guard function (RT-M1 fix)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func assertIsAdmin(addr address)")
        expect(code).toContain("only board admin can perform this action")
    })

    it("sets adminAddr in init (deployer is admin)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("adminAddr = runtime.PreviousRealm().Address()")
    })

    it("uses address type (modern Gno pattern)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("Author    address")
        expect(code).not.toContain("Author    std.Address")
    })

    it("uses runtime.PreviousRealm().Address() for caller identification", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("runtime.PreviousRealm().Address()")
        expect(code).not.toContain("std.GetOrigCaller()")
    })

    it("limits channels to 20 maximum (RT-M1)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("maximum 20 channels reached")
    })

    it("requires admin for CreateChannel (RT-M1)", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func CreateChannel(cur realm,")
        expect(code).toContain("assertIsAdmin(caller)")
    })

    it("generates ReplyToThread function", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func ReplyToThread(cur realm,")
    })

    it("generates CreateChannel admin function", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func CreateChannel(cur realm,")
    })

    it("generates Render function with routing", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func Render(path string) string")
        expect(code).toContain("renderBoardHome()")
        expect(code).toContain("renderChannel(")
        expect(code).toContain("renderThread(")
    })

    it("generates GetBoardConfig function", () => {
        const code = generateBoardCode(config)
        expect(code).toContain("func GetBoardConfig() string")
    })

    it("validates channel names and skips invalid ones", () => {
        const cfg = { ...config, channels: ["general", "INVALID", "dev-chat"] }
        const code = generateBoardCode(cfg)
        expect(code).toContain('"general"')
        expect(code).not.toContain('"INVALID"')
        expect(code).toContain('"dev-chat"')
    })

    it("ensures at least general channel when all invalid", () => {
        const cfg = { ...config, channels: ["INVALID!!!"] }
        const code = generateBoardCode(cfg)
        expect(code).toContain('"general"')
    })

    it("uses JSON.stringify for name/description safety", () => {
        const cfg = { ...config, name: 'My "DAO" Board', description: "It's awesome" }
        const code = generateBoardCode(cfg)
        // JSON.stringify auto-escapes quotes
        expect(code).toContain("boardName")
        expect(code).toContain("boardDescription")
    })
})

// ── buildDeployBoardMsg ───────────────────────────────────────

describe("buildDeployBoardMsg", () => {
    it("builds MsgAddPackage with correct structure", () => {
        const msg = buildDeployBoardMsg("g1caller", "gno.land/r/user/mydao_board", "package mydao_board\n")
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value.creator).toBe("g1caller")
        expect(msg.value.package.name).toBe("mydao_board")
        expect(msg.value.package.path).toBe("gno.land/r/user/mydao_board")
        expect(msg.value.package.files).toHaveLength(2)
    })

    it("sorts files alphabetically", () => {
        const msg = buildDeployBoardMsg("g1x", "gno.land/r/test/board", "code")
        const names = msg.value.package.files.map((f: { name: string }) => f.name)
        expect(names[0]).toBe("board.gno")
        expect(names[1]).toBe("gnomod.toml")
    })

    it("includes gnomod.toml with correct module path", () => {
        const msg = buildDeployBoardMsg("g1x", "gno.land/r/test/myboard", "code")
        const toml = msg.value.package.files.find((f: { name: string }) => f.name === "gnomod.toml")
        expect(toml?.body).toContain('module = "gno.land/r/test/myboard"')
        expect(toml?.body).toContain('gno = "0.9"')
    })
})

// ── buildCreateThreadMsg ──────────────────────────────────────

describe("buildCreateThreadMsg", () => {
    it("builds CreateThread MsgCall", () => {
        const msg = buildCreateThreadMsg("g1caller", "gno.land/r/test/board", "general", "Hello", "World")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("CreateThread")
        expect(msg.value.args).toEqual(["general", "Hello", "World"])
        expect(msg.value.pkg_path).toBe("gno.land/r/test/board")
        expect(msg.value.caller).toBe("g1caller")
    })
})

// ── buildReplyToThreadMsg ─────────────────────────────────────

describe("buildReplyToThreadMsg", () => {
    it("builds ReplyToThread MsgCall with thread ID as string", () => {
        const msg = buildReplyToThreadMsg("g1caller", "gno.land/r/test/board", "general", 42, "Nice post!")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("ReplyToThread")
        expect(msg.value.args).toEqual(["general", "42", "Nice post!"])
    })
})

// ── buildCreateChannelMsg ─────────────────────────────────────

describe("buildCreateChannelMsg", () => {
    it("builds CreateChannel MsgCall", () => {
        const msg = buildCreateChannelMsg("g1caller", "gno.land/r/test/board", "dev-chat")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("CreateChannel")
        expect(msg.value.args).toEqual(["dev-chat"])
    })
})

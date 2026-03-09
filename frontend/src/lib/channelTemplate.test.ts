/**
 * Channel Template Tests — validates realm code generation, ACL, token-gate,
 * channel types, and MsgCall builders for the v2.1a channel system.
 *
 * @format-dependent — some tests depend on the Gno realm Render() output format.
 */

import { describe, it, expect } from "vitest"
import {
    type ChannelConfig,
    type ChannelType,
    defaultChannelConfig,
    isValidChannelName,
    generateChannelCode,
    buildDeployChannelMsg,
    buildChannelCreateThreadMsg,
    buildChannelReplyMsg,
    buildCreateChannelMsg,
    buildSetACLMsg,
    buildArchiveChannelMsg,
    buildReorderChannelsMsg,
    buildEditMessageMsg,
    buildDeleteMessageMsg,
    MEMBA_CHANNEL_DEFS,
} from "./channelTemplate"

// ── Defaults ──────────────────────────────────────────────────

describe("defaultChannelConfig", () => {
    it("derives channel realm path with _channels suffix", () => {
        const config = defaultChannelConfig("gno.land/r/user/mydao", "MyDAO")
        expect(config.channelRealmPath).toBe("gno.land/r/user/mydao_channels")
    })

    it("sets human-readable name from DAO name", () => {
        const config = defaultChannelConfig("gno.land/r/user/mydao", "MyDAO")
        expect(config.name).toBe("MyDAO Channels")
        expect(config.description).toBe("Community channels for MyDAO")
    })

    it("defaults to single general channel", () => {
        const config = defaultChannelConfig("gno.land/r/user/mydao", "MyDAO")
        expect(config.channels).toHaveLength(1)
        expect(config.channels[0].name).toBe("general")
        expect(config.channels[0].type).toBe("text")
    })

    it("defaults to no token gate", () => {
        const config = defaultChannelConfig("gno.land/r/user/mydao", "MyDAO")
        expect(config.minTokenBalance).toBe(0)
        expect(config.tokenSymbol).toBe("")
    })

    it("defaults to 5 block rate limit", () => {
        const config = defaultChannelConfig("gno.land/r/user/mydao", "MyDAO")
        expect(config.minPostInterval).toBe(5)
    })
})

// ── MEMBA Channels Preset ─────────────────────────────────────

describe("MEMBA_CHANNEL_DEFS", () => {
    it("has exactly 6 channels", () => {
        expect(MEMBA_CHANNEL_DEFS).toHaveLength(6)
    })

    it("has correct channel names", () => {
        const names = MEMBA_CHANNEL_DEFS.map(c => c.name)
        expect(names).toEqual([
            "general", "announcements", "feature-requests",
            "support", "extensions", "partnerships",
        ])
    })

    it("marks announcements as admin-only write", () => {
        const ann = MEMBA_CHANNEL_DEFS.find(c => c.name === "announcements")
        expect(ann?.type).toBe("announcements")
        expect(ann?.acl.writeRoles).toEqual(["admin"])
    })

    it("allows all roles to write in general", () => {
        const gen = MEMBA_CHANNEL_DEFS.find(c => c.name === "general")
        expect(gen?.acl.writeRoles).toEqual(["member", "dev", "ops", "admin"])
    })

    it("restricts extensions to dev/ops/admin", () => {
        const ext = MEMBA_CHANNEL_DEFS.find(c => c.name === "extensions")
        expect(ext?.acl.writeRoles).toEqual(["dev", "ops", "admin"])
    })
})

// ── Channel Name Validation ───────────────────────────────────

describe("isValidChannelName", () => {
    it("accepts lowercase alphanumeric with hyphens", () => {
        expect(isValidChannelName("general")).toBe(true)
        expect(isValidChannelName("feature-requests")).toBe(true)
        expect(isValidChannelName("dev2")).toBe(true)
    })

    it("rejects uppercase", () => {
        expect(isValidChannelName("General")).toBe(false)
        expect(isValidChannelName("GENERAL")).toBe(false)
    })

    it("rejects spaces", () => {
        expect(isValidChannelName("my channel")).toBe(false)
    })

    it("rejects special characters except hyphens", () => {
        expect(isValidChannelName("my_channel")).toBe(false) // underscore not allowed
        expect(isValidChannelName("my.channel")).toBe(false)
        expect(isValidChannelName("my@channel")).toBe(false)
    })

    it("rejects empty string", () => {
        expect(isValidChannelName("")).toBe(false)
    })

    it("rejects names starting with number", () => {
        expect(isValidChannelName("1channel")).toBe(false)
    })

    it("rejects names longer than 30 chars", () => {
        expect(isValidChannelName("a".repeat(31))).toBe(false)
        expect(isValidChannelName("a".repeat(30))).toBe(true)
    })
})

// ── Code Generation ───────────────────────────────────────────

describe("generateChannelCode", () => {
    const baseConfig: ChannelConfig = {
        daoRealmPath: "gno.land/r/user/testdao",
        channelRealmPath: "gno.land/r/user/testdao_channels",
        name: "TestDAO Channels",
        description: "Test channels",
        channels: [
            { name: "general", type: "text", acl: { readRoles: [], writeRoles: [] } },
        ],
        minPostInterval: 5,
        minTokenBalance: 0,
        tokenFactoryPath: "gno.land/r/demo/defi/grc20factory",
        tokenSymbol: "",
        editWindowBlocks: 100,
    }

    it("generates valid Gno package declaration", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("package testdao_channels")
    })

    it("generates imports with std, strconv, strings", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain('"chain/runtime"')
        expect(code).toContain('"strconv"')
        expect(code).toContain('"strings"')
    })

    it("generates Channel struct with ACL fields", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("ChanType   string")
        expect(code).toContain("ReadRoles  string")
        expect(code).toContain("WriteRoles string")
        expect(code).toContain("Archived   bool")
    })

    it("generates Thread struct with edit/delete fields", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("EditedAt  int64")
        expect(code).toContain("Deleted   bool")
    })

    it("initializes channels in init()", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain('Name:       "general"')
        expect(code).toContain('ChanType:   "text"')
    })

    it('initializes channel order in init()', () => {
        const config = {
            ...baseConfig, channels: [
                { name: "general", type: "text" as ChannelType, acl: { readRoles: [], writeRoles: [] } },
                { name: "dev", type: "text" as ChannelType, acl: { readRoles: [], writeRoles: [] } },
            ]
        }
        const code = generateChannelCode(config)
        expect(code).toContain('channelOrder = append(channelOrder, "general")')
        expect(code).toContain('channelOrder = append(channelOrder, "dev")')
    })

    it("generates Render with __acl/ path support", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain('strings.HasPrefix(path, "__acl/")')
        expect(code).toContain("renderACL")
    })

    it("generates renderHome with channel type indicators", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("📢")
        expect(code).toContain("🔒")
    })

    it("generates CreateThread with token gate check", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("assertHasTokens(caller)")
        expect(code).toContain("assertChannelWritable(channel, caller)")
    })

    it("generates edit/delete functions", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("func EditMessage(cur realm,")
        expect(code).toContain("func DeleteMessage(cur realm,")
    })

    it("generates admin actions: CreateChannel, SetChannelACL, ArchiveChannel, ReorderChannels", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("func CreateChannel(cur realm,")
        expect(code).toContain("func SetChannelACL(cur realm,")
        expect(code).toContain("func ArchiveChannel(cur realm,")
        expect(code).toContain("func ReorderChannels(cur realm,")
    })

    it("generates no-op token gate when minTokenBalance is 0", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("assertHasTokens is a no-op")
        expect(code).not.toContain("grc20factory")
    })

    // ── Token Gate ────────────────────────────────────────────

    it("generates token gate import when minTokenBalance > 0", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            minTokenBalance: 10,
            tokenSymbol: "MEMBATEST",
        }
        const code = generateChannelCode(config)
        expect(code).toContain('grc20factory "gno.land/r/demo/defi/grc20factory"')
    })

    it("generates token balance check with correct symbol", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            minTokenBalance: 10,
            tokenSymbol: "MEMBATEST",
        }
        const code = generateChannelCode(config)
        expect(code).toContain('grc20factory.BalanceOf("MEMBATEST"')
        expect(code).toContain("insufficient $MEMBATEST balance")
    })

    // ── Channel Types ─────────────────────────────────────────

    it("generates announcement channel guard", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            channels: [
                { name: "news", type: "announcements", acl: { readRoles: [], writeRoles: ["admin"] } },
            ],
        }
        const code = generateChannelCode(config)
        expect(code).toContain('"announcements"')
        expect(code).toContain("only admin can post in announcement channels")
    })

    it("generates readonly channel guard", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain('"readonly"')
        expect(code).toContain("channel is read-only")
    })

    it("generates archived channel guard", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("channel is archived")
    })

    // ── ACL ───────────────────────────────────────────────────

    it("initializes ACL roles in channel init", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            channels: [
                { name: "dev", type: "text", acl: { readRoles: ["dev", "admin"], writeRoles: ["dev", "admin"] } },
            ],
        }
        const code = generateChannelCode(config)
        expect(code).toContain('ReadRoles:  "dev,admin"')
        expect(code).toContain('WriteRoles: "dev,admin"')
    })

    it("initializes empty ACL as empty strings", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain('ReadRoles:  ""')
        expect(code).toContain('WriteRoles: ""')
    })

    // ── Edge Cases ────────────────────────────────────────────

    it("falls back to general channel if all channels have invalid names", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            channels: [
                { name: "INVALID", type: "text", acl: { readRoles: [], writeRoles: [] } },
            ],
        }
        const code = generateChannelCode(config)
        expect(code).toContain('Name:       "general"')
    })

    it("filters out invalid channel names from config", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            channels: [
                { name: "good", type: "text", acl: { readRoles: [], writeRoles: [] } },
                { name: "BAD!", type: "text", acl: { readRoles: [], writeRoles: [] } },
            ],
        }
        const code = generateChannelCode(config)
        expect(code).toContain('"good"')
        expect(code).not.toContain('"BAD!"')
    })

    it("sanitizes name and description via JSON.stringify", () => {
        const config: ChannelConfig = {
            ...baseConfig,
            name: 'Test "Quotes" & <script>',
            description: "Line1\nLine2",
        }
        const code = generateChannelCode(config)
        // JSON.stringify escapes quotes and newlines
        expect(code).toContain('channelRealmName = "Test \\"Quotes\\" & <script>"')
    })

    it("generates 50 channel max guard", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("maximum 50 channels reached")
    })

    it("generates edit window of 100 blocks", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("edit window expired (100 blocks)")
    })

    it("uses custom edit window from config", () => {
        const config: ChannelConfig = { ...baseConfig, editWindowBlocks: 50 }
        const code = generateChannelCode(config)
        expect(code).toContain("edit window expired (50 blocks)")
        expect(code).not.toContain("100 blocks")
    })

    it("generates GetChannelConfig function", () => {
        const code = generateChannelCode(baseConfig)
        expect(code).toContain("func GetChannelConfig() string")
    })
})

// ── MsgAddPackage Builder ─────────────────────────────────────

describe("buildDeployChannelMsg", () => {
    it("builds /vm.m_addpkg message", () => {
        const msg = buildDeployChannelMsg("g1caller", "gno.land/r/user/mydao_channels", "package code")
        expect(msg.type).toBe("/vm.m_addpkg")
    })

    it("derives package name from path", () => {
        const msg = buildDeployChannelMsg("g1caller", "gno.land/r/user/mydao_channels", "code")
        const value = msg.value as Record<string, unknown>
        const pkg = value.package as Record<string, unknown>
        expect(pkg.name).toBe("mydao_channels")
    })

    it("includes .gno and gnomod.toml files sorted", () => {
        const msg = buildDeployChannelMsg("g1caller", "gno.land/r/user/mydao_channels", "code")
        const value = msg.value as Record<string, unknown>
        const pkg = value.package as Record<string, unknown>
        const files = pkg.files as Array<{ name: string; body: string }>
        expect(files).toHaveLength(2)
        // Sorted: gnomod.toml comes before mydao_channels.gno
        expect(files[0].name).toBe("gnomod.toml")
        expect(files[1].name).toBe("mydao_channels.gno")
    })

    it("sets deposit to empty string when not provided", () => {
        const msg = buildDeployChannelMsg("g1caller", "gno.land/r/user/mydao_channels", "code")
        expect((msg.value as Record<string, unknown>).deposit).toBe("")
    })
})

// ── MsgCall Builders ──────────────────────────────────────────

describe("buildChannelCreateThreadMsg", () => {
    it("builds MsgCall for CreateThread", () => {
        const msg = buildChannelCreateThreadMsg("g1a", "gno.land/r/u/dao_channels", "general", "Title", "Body")
        expect(msg.type).toBe("vm/MsgCall")
        expect((msg.value as Record<string, unknown>).func).toBe("CreateThread")
        expect((msg.value as Record<string, unknown>).args).toEqual(["general", "Title", "Body"])
    })

    it("sets pkg_path to channel realm path", () => {
        const msg = buildChannelCreateThreadMsg("g1a", "gno.land/r/u/dao_channels", "dev", "T", "B")
        expect((msg.value as Record<string, unknown>).pkg_path).toBe("gno.land/r/u/dao_channels")
    })
})

describe("buildChannelReplyMsg", () => {
    it("builds MsgCall for ReplyToThread with string threadId", () => {
        const msg = buildChannelReplyMsg("g1a", "gno.land/r/u/dao_channels", "general", 42, "reply body")
        expect((msg.value as Record<string, unknown>).func).toBe("ReplyToThread")
        expect((msg.value as Record<string, unknown>).args).toEqual(["general", "42", "reply body"])
    })
})

describe("buildCreateChannelMsg", () => {
    it("includes channel type and role args", () => {
        const msg = buildCreateChannelMsg("g1a", "gno.land/r/u/dao_channels", "news", "announcements", "", "admin")
        expect((msg.value as Record<string, unknown>).func).toBe("CreateChannel")
        expect((msg.value as Record<string, unknown>).args).toEqual(["news", "announcements", "", "admin"])
    })

    it("defaults type to text", () => {
        const msg = buildCreateChannelMsg("g1a", "gno.land/r/u/dao_channels", "general")
        expect((msg.value as Record<string, unknown>).args).toEqual(["general", "text", "", ""])
    })
})

describe("buildSetACLMsg", () => {
    it("builds MsgCall for SetChannelACL", () => {
        const msg = buildSetACLMsg("g1a", "gno.land/r/u/dao_channels", "dev", "dev,admin", "dev,admin")
        expect((msg.value as Record<string, unknown>).func).toBe("SetChannelACL")
        expect((msg.value as Record<string, unknown>).args).toEqual(["dev", "dev,admin", "dev,admin"])
    })
})

describe("buildArchiveChannelMsg", () => {
    it("builds MsgCall for ArchiveChannel", () => {
        const msg = buildArchiveChannelMsg("g1a", "gno.land/r/u/dao_channels", "old")
        expect((msg.value as Record<string, unknown>).func).toBe("ArchiveChannel")
        expect((msg.value as Record<string, unknown>).args).toEqual(["old"])
    })
})

describe("buildReorderChannelsMsg", () => {
    it("joins channel names with comma", () => {
        const msg = buildReorderChannelsMsg("g1a", "gno.land/r/u/dao_channels", ["dev", "general", "support"])
        expect((msg.value as Record<string, unknown>).func).toBe("ReorderChannels")
        expect((msg.value as Record<string, unknown>).args).toEqual(["dev,general,support"])
    })
})

describe("buildEditMessageMsg", () => {
    it("builds MsgCall for EditMessage with replyId", () => {
        const msg = buildEditMessageMsg("g1a", "gno.land/r/u/dao_channels", "general", 5, 3, "new body")
        expect((msg.value as Record<string, unknown>).func).toBe("EditMessage")
        expect((msg.value as Record<string, unknown>).args).toEqual(["general", "5", "3", "new body"])
    })
})

describe("buildDeleteMessageMsg", () => {
    it("builds MsgCall for DeleteMessage", () => {
        const msg = buildDeleteMessageMsg("g1a", "gno.land/r/u/dao_channels", "general", 5, -1)
        expect((msg.value as Record<string, unknown>).func).toBe("DeleteMessage")
        expect((msg.value as Record<string, unknown>).args).toEqual(["general", "5", "-1"])
    })
})

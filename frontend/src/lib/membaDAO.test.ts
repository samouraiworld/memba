/**
 * MembaDAO Tests — configuration, deployment steps, membership, and MsgCall builders.
 */

import { describe, it, expect } from "vitest"
import {
    MEMBA_DAO_CONFIG,
    MEMBA_DAO_CHANNELS,
    ZOOMA_ADDRESS,
    getDeploymentSteps,
    isMembaDAO,
    buildAddMemberMsg,
} from "./membaDAO"

// ── Config ────────────────────────────────────────────────────

describe("MEMBA_DAO_CONFIG", () => {
    it("has correct name", () => {
        expect(MEMBA_DAO_CONFIG.name).toBe("MembaDAO")
    })

    it("has 66% threshold", () => {
        expect(MEMBA_DAO_CONFIG.threshold).toBe(66)
    })

    it("has 50% quorum", () => {
        expect(MEMBA_DAO_CONFIG.quorum).toBe(50)
    })

    it("includes admin role", () => {
        expect(MEMBA_DAO_CONFIG.roles).toContain("admin")
    })

    it("includes dev role", () => {
        expect(MEMBA_DAO_CONFIG.roles).toContain("dev")
    })

    it("has zôÖma as founding member", () => {
        expect(MEMBA_DAO_CONFIG.members[0].address).toBe(ZOOMA_ADDRESS)
    })

    it("uses MEMBA or MEMBATEST symbol", () => {
        expect(MEMBA_DAO_CONFIG.tokenSymbol).toMatch(/^MEMBA/)
    })

    it("has 4 proposal categories", () => {
        expect(MEMBA_DAO_CONFIG.proposalCategories).toHaveLength(4)
    })
})

// ── Channels ──────────────────────────────────────────────────

describe("MEMBA_DAO_CHANNELS", () => {
    it("has 6 default channels", () => {
        expect(MEMBA_DAO_CHANNELS).toHaveLength(6)
    })

    it("has general as first channel", () => {
        expect(MEMBA_DAO_CHANNELS[0].name).toBe("general")
    })

    it("has announcements channel with admin-write type", () => {
        const ann = MEMBA_DAO_CHANNELS.find(c => c.name === "announcements")
        expect(ann?.type).toBe("announcements")
    })

    it("all channels have descriptions", () => {
        MEMBA_DAO_CHANNELS.forEach(ch => {
            expect(ch.description.length).toBeGreaterThan(0)
        })
    })
})

// ── Deployment Steps ──────────────────────────────────────────

describe("getDeploymentSteps", () => {
    it("returns 4 deployment steps", () => {
        const steps = getDeploymentSteps({ dao: false, channels: false, candidature: false, token: false })
        expect(steps).toHaveLength(4)
    })

    it("shows pending status for undeployed components", () => {
        const steps = getDeploymentSteps({ dao: false, channels: false, candidature: false, token: false })
        steps.forEach(s => expect(s.status).toBe("pending"))
    })

    it("shows deployed status for deployed components", () => {
        const steps = getDeploymentSteps({ dao: true, channels: true, candidature: true, token: true })
        steps.forEach(s => expect(s.status).toBe("deployed"))
    })

    it("shows mixed status correctly", () => {
        const steps = getDeploymentSteps({ dao: true, channels: false, candidature: false, token: true })
        expect(steps[0].status).toBe("deployed") // dao
        expect(steps[1].status).toBe("pending")  // channels
        expect(steps[2].status).toBe("pending")  // candidature
        expect(steps[3].status).toBe("deployed") // token
    })

    it("includes meaningful labels", () => {
        const steps = getDeploymentSteps({ dao: false, channels: false, candidature: false, token: false })
        expect(steps[0].label).toContain("MembaDAO")
        expect(steps[1].label).toContain("Channels")
        expect(steps[2].label).toContain("Candidature")
        expect(steps[3].label).toContain("$MEMBA")
    })
})

// ── isMembaDAO ────────────────────────────────────────────────

describe("isMembaDAO", () => {
    it("returns true for MembaDAO realm path", () => {
        expect(isMembaDAO("gno.land/r/samcrew/memba_dao")).toBe(true)
    })

    it("returns false for other DAO paths", () => {
        expect(isMembaDAO("gno.land/r/demo/dao")).toBe(false)
    })

    it("returns false for empty string", () => {
        expect(isMembaDAO("")).toBe(false)
    })
})

// ── buildAddMemberMsg ─────────────────────────────────────────

describe("buildAddMemberMsg", () => {
    it("builds correct AddMember message", () => {
        const msg = buildAddMemberMsg("g1admin", "g1newmember")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("AddMember")
        expect(msg.value.args).toEqual(["g1newmember", "1"])
    })

    it("allows custom power", () => {
        const msg = buildAddMemberMsg("g1admin", "g1newmember", 2)
        expect(msg.value.args).toEqual(["g1newmember", "2"])
    })

    it("targets MembaDAO realm", () => {
        const msg = buildAddMemberMsg("g1admin", "g1new")
        expect(msg.value.pkg_path).toContain("memba_dao")
    })
})

/**
 * monitoringAuth.test.ts — the wire boundary between Memba's domain model and
 * gnomonitoring's JSON.
 *
 * Only ChainID carries a JSON tag server-side (`json:"chain_id"`); every other
 * field is untagged and matches case-insensitively. Serializing the domain
 * object directly is what sent "ChainID" on the wire and produced a permanent
 * "chain_id is required" 400.
 */
import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("./config", () => ({
    GNO_MONITORING_API_URL: "https://mock-monitoring.example.com",
    GNO_CHAIN_ID: "mock-chain",
}))

import { createWebhook, updateWebhook, listWebhooks } from "./monitoringAuth"

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
    } as unknown as Response
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
}

describe("webhook wire format", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("sends chain_id in snake_case and never ChainID", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse("", true, 201))
        vi.stubGlobal("fetch", fetchMock)

        await createWebhook("tok", "validator", {
            URL: "https://discord.com/api/webhooks/abc",
            Type: "discord",
            Description: "test",
            ChainID: "topaz-1",
        })

        const body = bodyOf(fetchMock)
        expect(body.chain_id).toBe("topaz-1")
        expect(body).not.toHaveProperty("ChainID")
    })

    it("keeps the untagged fields PascalCase — they are correct as-is", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse("", true, 201))
        vi.stubGlobal("fetch", fetchMock)

        await createWebhook("tok", "govdao", {
            URL: "https://discord.com/api/webhooks/abc",
            Type: "discord",
            Description: "test",
            ChainID: "topaz-1",
        })

        const body = bodyOf(fetchMock)
        expect(body.URL).toBe("https://discord.com/api/webhooks/abc")
        expect(body.Type).toBe("discord")
        expect(body.Description).toBe("test")
    })

    it("OMITS chain_id when unset — never null, never empty string", async () => {
        // The server rejects an empty/null chain_id but treats an ABSENT one on
        // PUT as "leave the stored chain untouched". Absence is the only safe
        // encoding for "do not change".
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse("", true, 200))
        vi.stubGlobal("fetch", fetchMock)

        await updateWebhook("tok", "validator", {
            ID: 7,
            URL: "https://discord.com/api/webhooks/abc",
            Type: "discord",
            Description: "test",
            ChainID: null,
        })

        const body = bodyOf(fetchMock)
        expect(body).not.toHaveProperty("chain_id")
        expect(body.ID).toBe(7)
    })

    it("maps chain_id back to ChainID when reading", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([
            {
                ID: 1,
                URL: "https://discord.com/api/webhooks/a",
                Type: "discord",
                Description: "d",
                chain_id: "topaz-1",
            },
        ])))

        const list = await listWebhooks("tok", "validator")
        expect(list[0].ChainID).toBe("topaz-1")
    })
})

describe("webhook list robustness", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("does NOT scope the request to the active chain", async () => {
        // The selector offers every chain gnomonitoring accepts. Filtering the
        // list by Memba's active chain would make a webhook created on any
        // other chain invisible — and therefore uneditable and undeletable.
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
        vi.stubGlobal("fetch", fetchMock)

        await listWebhooks("tok", "validator")

        expect(fetchMock.mock.calls[0][0]).toBe(
            "https://mock-monitoring.example.com/webhooks/validator",
        )
    })

    it("returns [] for the server's no-webhook OBJECT", async () => {
        // With zero webhooks the server replies {"message":"no webhook found"},
        // not []. Leaking that object gave it .length === undefined, so neither
        // the list nor the empty state rendered — a blank panel.
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
            jsonResponse({ message: "no webhook found" }),
        ))

        await expect(listWebhooks("tok", "govdao")).resolves.toEqual([])
    })
})

describe("endpoint routing per kind", () => {
    // The two kinds are separate server tables with independent primary keys.
    // Routing a validator call to /webhooks/govdao would silently read or write
    // the wrong table, so pin the mapping for every verb.
    afterEach(() => vi.unstubAllGlobals())

    const payload = {
        URL: "https://discord.com/api/webhooks/abc",
        Type: "discord" as const,
        Description: "test",
        ChainID: "topaz-1",
    }

    function urlOf(fetchMock: ReturnType<typeof vi.fn>): string {
        return fetchMock.mock.calls[0][0] as string
    }

    it.each([
        ["validator" as const, "https://mock-monitoring.example.com/webhooks/validator"],
        ["govdao" as const, "https://mock-monitoring.example.com/webhooks/govdao"],
    ])("routes %s reads and writes to its own endpoint", async (kind, expected) => {
        const listMock = vi.fn().mockResolvedValue(jsonResponse([]))
        vi.stubGlobal("fetch", listMock)
        await listWebhooks("tok", kind)
        expect(urlOf(listMock)).toBe(expected)

        const createMock = vi.fn().mockResolvedValue(jsonResponse("", true, 201))
        vi.stubGlobal("fetch", createMock)
        await createWebhook("tok", kind, payload)
        expect(urlOf(createMock)).toBe(expected)
        expect((createMock.mock.calls[0][1] as RequestInit).method).toBe("POST")

        const updateMock = vi.fn().mockResolvedValue(jsonResponse("", true, 200))
        vi.stubGlobal("fetch", updateMock)
        await updateWebhook("tok", kind, { ...payload, ID: 1 })
        expect(urlOf(updateMock)).toBe(expected)
        expect((updateMock.mock.calls[0][1] as RequestInit).method).toBe("PUT")
    })
})

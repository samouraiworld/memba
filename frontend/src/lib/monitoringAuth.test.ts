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

import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendClient } from "./client.js";
import type { BackendAnalysisRequest } from "../analysis/types.js";

function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ results: [], modelsUsed: [], processingTimeMs: 1, tier: "free" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("BackendClient.analyze payload", () => {
  it("sends only the perspective and its data, never model instructions", async () => {
    const calls = stubFetch();
    const client = new BackendClient({ backendUrl: "http://backend.test", token: "tok" });

    // Extra fields from an untyped caller must not be forwarded.
    const request = {
      perspectives: [
        {
          perspective: "technical",
          proposalData: "proposal",
          daoContext: "dao",
          treasuryContext: "10 GNOT",
          systemPrompt: "SYSTEM",
          userPrompt: "USER",
        },
      ],
      tier: "pro",
    } as unknown as BackendAnalysisRequest;

    await client.analyze(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://backend.test/api/analyst/analyze");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.perspectives).toEqual([
      { perspective: "technical", proposalData: "proposal", daoContext: "dao", treasuryContext: "10 GNOT" },
    ]);
    expect(body.tier).toBe("pro");
  });

  it("does not send a userAddress; the backend uses the token's wallet", async () => {
    vi.stubEnv("DAO_ANALYST_USER_ADDRESS", "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const calls = stubFetch();
    const client = new BackendClient({
      backendUrl: "http://backend.test",
      token: "tok",
      userAddress: "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    } as ConstructorParameters<typeof BackendClient>[0]);

    await client.analyze({
      perspectives: [{ perspective: "financial", proposalData: "p", daoContext: "d" }],
      tier: "pro",
      userAddress: "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    } as unknown as BackendAnalysisRequest);

    const body = JSON.parse(String(calls[0].init.body));
    expect("userAddress" in body).toBe(false);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
  });
});

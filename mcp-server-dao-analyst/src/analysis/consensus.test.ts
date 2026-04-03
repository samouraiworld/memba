import { describe, it, expect } from "vitest";
import { buildConsensus } from "./consensus.js";
import type { PerspectiveResult } from "./types.js";

function makePerspective(
  overrides: Partial<PerspectiveResult> = {}
): PerspectiveResult {
  return {
    perspective: "technical",
    model: "test-model",
    verdict: "approve",
    confidence: 0.8,
    reasoning: "Test reasoning",
    risks: ["risk1"],
    recommendations: ["rec1"],
    ...overrides,
  };
}

describe("buildConsensus", () => {
  it("returns abstain for empty results", () => {
    const result = buildConsensus([]);
    expect(result.overallVerdict).toBe("abstain");
    expect(result.confidence).toBe(0);
    expect(result.agreementLevel).toBe("contested");
  });

  it("returns unanimous when all agree", () => {
    const results = [
      makePerspective({ perspective: "technical", verdict: "approve", confidence: 0.9 }),
      makePerspective({ perspective: "financial", verdict: "approve", confidence: 0.8 }),
      makePerspective({ perspective: "legal", verdict: "approve", confidence: 0.7 }),
    ];

    const consensus = buildConsensus(results);
    expect(consensus.overallVerdict).toBe("approve");
    expect(consensus.agreementLevel).toBe("unanimous");
    expect(consensus.confidence).toBeGreaterThan(0.5);
  });

  it("returns split when verdicts diverge", () => {
    const results = [
      makePerspective({ perspective: "technical", verdict: "approve", confidence: 0.8 }),
      makePerspective({ perspective: "financial", verdict: "reject", confidence: 0.9 }),
      makePerspective({ perspective: "legal", verdict: "caution", confidence: 0.6 }),
    ];

    const consensus = buildConsensus(results);
    expect(consensus.agreementLevel).toBe("contested");
  });

  it("applies higher weight to financial and technical perspectives", () => {
    // Financial says reject with high confidence, legal says approve with low
    const results = [
      makePerspective({ perspective: "financial", verdict: "reject", confidence: 0.9 }),
      makePerspective({ perspective: "legal", verdict: "approve", confidence: 0.5 }),
    ];

    const consensus = buildConsensus(results);
    // Financial has 1.2x weight, so reject should win
    expect(consensus.overallVerdict).toBe("reject");
  });

  it("deduplicates risks and recommendations", () => {
    const results = [
      makePerspective({
        perspective: "technical",
        risks: ["Smart contract vulnerability", "No audit"],
        recommendations: ["Conduct audit"],
      }),
      makePerspective({
        perspective: "financial",
        risks: ["smart contract vulnerability", "Budget overrun"],
        recommendations: ["Conduct audit", "Phase rollout"],
      }),
    ];

    const consensus = buildConsensus(results);
    // "Smart contract vulnerability" appears twice with different casing — deduped
    expect(consensus.keyRisks).toHaveLength(3);
    expect(consensus.keyRecommendations).toHaveLength(2);
  });

  it("generates a non-empty summary", () => {
    const results = [
      makePerspective({ perspective: "technical", verdict: "approve" }),
      makePerspective({ perspective: "financial", verdict: "approve" }),
    ];

    const consensus = buildConsensus(results);
    expect(consensus.summary).toBeTruthy();
    expect(consensus.summary).toContain("approve");
  });

  it("handles single perspective", () => {
    const results = [
      makePerspective({ perspective: "technical", verdict: "caution", confidence: 0.7 }),
    ];

    const consensus = buildConsensus(results);
    expect(consensus.overallVerdict).toBe("caution");
    // Single perspective → contested agreement
    expect(consensus.agreementLevel).toBe("contested");
  });

  it("scales confidence by completeness", () => {
    // Only 1 of 3 perspectives
    const partial = buildConsensus([
      makePerspective({ confidence: 0.9 }),
    ]);

    // All 3 perspectives
    const full = buildConsensus([
      makePerspective({ perspective: "technical", confidence: 0.9 }),
      makePerspective({ perspective: "financial", confidence: 0.9 }),
      makePerspective({ perspective: "legal", confidence: 0.9 }),
    ]);

    expect(full.confidence).toBeGreaterThan(partial.confidence);
  });
});

/**
 * Consensus aggregation — combines multiple perspective results into a verdict.
 *
 * No LLM call needed — this is pure local logic.
 * Weighted voting with configurable perspective weights.
 */

import type {
  AgreementLevel,
  ConsensusResult,
  Perspective,
  PerspectiveResult,
  Verdict,
} from "./types.js";

/** Perspective weights — financial and technical get a slight boost for proposal analysis. */
const PERSPECTIVE_WEIGHTS: Record<Perspective, number> = {
  financial: 1.2,
  technical: 1.2,
  legal: 1.0,
};

/**
 * Aggregate multiple perspective results into a consensus.
 */
export function buildConsensus(results: PerspectiveResult[]): ConsensusResult {
  if (results.length === 0) {
    return {
      overallVerdict: "abstain",
      confidence: 0,
      agreementLevel: "contested",
      perspectives: [],
      summary: "No analysis results available.",
      keyRisks: [],
      keyRecommendations: [],
    };
  }

  const overallVerdict = computeWeightedVerdict(results);
  const confidence = computeWeightedConfidence(results);
  const agreementLevel = computeAgreementLevel(results);

  // Deduplicate risks and recommendations across perspectives
  const keyRisks = deduplicateStrings(results.flatMap((r) => r.risks)).slice(0, 10);
  const keyRecommendations = deduplicateStrings(
    results.flatMap((r) => r.recommendations)
  ).slice(0, 10);

  const summary = buildSummary(overallVerdict, agreementLevel, confidence, results);

  return {
    overallVerdict,
    confidence,
    agreementLevel,
    perspectives: results,
    summary,
    keyRisks,
    keyRecommendations,
  };
}

function computeWeightedVerdict(results: PerspectiveResult[]): Verdict {
  const scores: Record<Verdict, number> = {
    approve: 0,
    reject: 0,
    caution: 0,
    abstain: 0,
  };

  for (const result of results) {
    const weight = PERSPECTIVE_WEIGHTS[result.perspective] ?? 1.0;
    scores[result.verdict] += weight * result.confidence;
  }

  // Find verdict with highest weighted score
  let maxVerdict: Verdict = "abstain";
  let maxScore = -1;

  for (const [verdict, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxVerdict = verdict as Verdict;
    }
  }

  return maxVerdict;
}

function computeWeightedConfidence(results: PerspectiveResult[]): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    const weight = PERSPECTIVE_WEIGHTS[result.perspective] ?? 1.0;
    weightedSum += result.confidence * weight;
    totalWeight += weight;
  }

  // Scale by completeness (n/3 perspectives available)
  const completeness = Math.min(results.length / 3, 1);
  const raw = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return Math.round(raw * completeness * 100) / 100;
}

function computeAgreementLevel(results: PerspectiveResult[]): AgreementLevel {
  if (results.length <= 1) return "contested";

  const verdicts = results.map((r) => r.verdict);
  const uniqueVerdicts = new Set(verdicts);

  if (uniqueVerdicts.size === 1) return "unanimous";

  // Count the most common verdict
  const counts: Record<string, number> = {};
  for (const v of verdicts) counts[v] = (counts[v] || 0) + 1;
  const maxCount = Math.max(...Object.values(counts));
  const ratio = maxCount / results.length;

  if (ratio >= 0.75) return "strong";
  if (ratio >= 0.5) return "split";
  return "contested";
}

function buildSummary(
  verdict: Verdict,
  agreement: AgreementLevel,
  confidence: number,
  results: PerspectiveResult[]
): string {
  const verdictText: Record<Verdict, string> = {
    approve: "The proposal is recommended for approval",
    reject: "The proposal is not recommended for approval",
    caution: "The proposal warrants caution and further review",
    abstain: "Insufficient data to form a recommendation",
  };

  const agreementText: Record<AgreementLevel, string> = {
    unanimous: "All perspectives unanimously agree.",
    strong: "Strong agreement across perspectives with minor divergence.",
    split: "Perspectives are split — significant disagreement exists.",
    contested: "Perspectives strongly disagree — thorough review recommended.",
  };

  const perspectiveSummaries = results
    .map((r) => `${r.perspective}: ${r.verdict} (${Math.round(r.confidence * 100)}%)`)
    .join(", ");

  return (
    `${verdictText[verdict]} (confidence: ${Math.round(confidence * 100)}%). ` +
    `${agreementText[agreement]} ` +
    `Breakdown: ${perspectiveSummaries}.`
  );
}

function deduplicateStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.toLowerCase().trim();
    if (!seen.has(normalized) && normalized.length > 0) {
      seen.add(normalized);
      result.push(item.trim());
    }
  }

  return result;
}

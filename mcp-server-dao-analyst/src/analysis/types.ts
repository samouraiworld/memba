/**
 * Types for multi-perspective governance analysis.
 */

export type Perspective = "legal" | "technical" | "financial";

export type Verdict = "approve" | "reject" | "caution" | "abstain";

export type AgreementLevel = "unanimous" | "strong" | "split" | "contested";

export interface PerspectiveResult {
  perspective: Perspective;
  model: string;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  risks: string[];
  recommendations: string[];
}

export interface ConsensusResult {
  overallVerdict: Verdict;
  confidence: number;
  agreementLevel: AgreementLevel;
  perspectives: PerspectiveResult[];
  summary: string;
  keyRisks: string[];
  keyRecommendations: string[];
}

export interface AnalysisRequest {
  perspective: Perspective;
  proposalData: string;
  daoContext: string;
  treasuryContext?: string;
}

export interface BackendAnalysisRequest {
  perspectives: AnalysisRequest[];
  tier: "free" | "pro";
}

export interface BackendAnalysisResponse {
  results: PerspectiveResult[];
  modelsUsed: string[];
  processingTimeMs: number;
}

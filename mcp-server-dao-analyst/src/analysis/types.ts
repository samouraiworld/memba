/**
 * Types for multi-perspective governance analysis.
 */

export type Perspective =
  | "legal"
  | "technical"
  | "financial"
  | "strategic"
  | "risk"
  | "reasoning"
  | "community"
  | "regulatory"
  | "security"
  | "contrarian";

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
  systemPrompt?: string;
  userPrompt?: string;
}

export interface BackendAnalysisRequest {
  perspectives: AnalysisRequest[];
  tier: "free" | "pro";
  userAddress?: string;
}

export interface BackendAnalysisResponse {
  results: PerspectiveResult[];
  modelsUsed: string[];
  processingTimeMs: number;
  tier: "free" | "pro";
  downgraded?: boolean;
}

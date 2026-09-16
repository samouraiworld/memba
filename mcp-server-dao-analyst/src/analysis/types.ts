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

/**
 * One perspective sent to the backend. Model instructions are owned by the
 * backend and selected by `perspective`; the other fields are passed to the
 * model as data only.
 */
export interface AnalysisRequest {
  perspective: Perspective;
  proposalData: string;
  daoContext: string;
  treasuryContext?: string;
}

/**
 * PRO credits are resolved by the backend for the wallet behind the auth
 * token, so the request carries no address.
 */
export interface BackendAnalysisRequest {
  perspectives: AnalysisRequest[];
  tier: "free" | "pro";
}

export interface BackendAnalysisResponse {
  results: PerspectiveResult[];
  modelsUsed: string[];
  processingTimeMs: number;
  tier: "free" | "pro";
  downgraded?: boolean;
}

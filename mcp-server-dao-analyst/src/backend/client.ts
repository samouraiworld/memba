/**
 * Backend client — communicates with the Memba backend's analyst endpoints.
 *
 * The MCP server is a thin client. All LLM calls go through the backend
 * which manages API keys, rate limits, and tier gating.
 */

import type {
  BackendAnalysisRequest,
  BackendAnalysisResponse,
  PerspectiveResult,
  Perspective,
  Verdict,
} from "../analysis/types.js";

const DEFAULT_BACKEND_URL = "http://localhost:8080";
const TIMEOUT_MS = 60_000; // LLM calls can take up to 30s

export interface BackendClientConfig {
  /** Memba backend URL. Defaults to localhost:8080. */
  backendUrl?: string;
  /** Auth token for PRO tier. Optional — free tier if absent. */
  token?: string;
  /** User's Gno address for on-chain credit lookup. */
  userAddress?: string;
}

export class BackendClient {
  private backendUrl: string;
  private token?: string;
  private userAddress?: string;

  constructor(config: BackendClientConfig = {}) {
    this.backendUrl =
      config.backendUrl ||
      process.env.MEMBA_BACKEND_URL ||
      process.env.MEMBA_API_URL ||
      DEFAULT_BACKEND_URL;
    this.token = config.token || process.env.DAO_ANALYST_TOKEN;
    this.userAddress = config.userAddress || process.env.DAO_ANALYST_USER_ADDRESS;
  }

  /**
   * Send analysis request to the backend.
   * The backend handles LLM routing, key management, and rate limiting.
   */
  async analyze(request: BackendAnalysisRequest): Promise<BackendAnalysisResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      // Inject user address for on-chain credit lookup
      const payload = {
        ...request,
        userAddress: this.userAddress,
      };

      const res = await fetch(`${this.backendUrl}/api/analyst/analyze`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Backend error (${res.status}): ${errBody}`);
      }

      return (await res.json()) as BackendAnalysisResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if the backend is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);

      const res = await fetch(`${this.backendUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the configured backend URL for diagnostics.
   */
  get url(): string {
    return this.backendUrl;
  }

  get tier(): "free" | "pro" {
    return this.token ? "pro" : "free";
  }
}

/**
 * Parse a raw LLM JSON response into a PerspectiveResult.
 * Handles malformed JSON gracefully.
 */
export function parseLLMResponse(
  raw: string,
  perspective: Perspective,
  model: string
): PerspectiveResult {
  try {
    // Extract JSON from potential markdown code blocks
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      perspective,
      model,
      verdict: validateVerdict(parsed.verdict),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || "No reasoning provided"),
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.map(String).slice(0, 10)
        : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map(String).slice(0, 10)
        : [],
    };
  } catch {
    // LLM returned non-JSON — wrap raw text as reasoning
    return {
      perspective,
      model,
      verdict: "abstain",
      confidence: 0.3,
      reasoning: raw.slice(0, 500),
      risks: ["LLM response was not structured — analysis may be unreliable"],
      recommendations: [],
    };
  }
}

function validateVerdict(v: unknown): Verdict {
  const valid: Verdict[] = ["approve", "reject", "caution", "abstain"];
  return valid.includes(v as Verdict) ? (v as Verdict) : "abstain";
}

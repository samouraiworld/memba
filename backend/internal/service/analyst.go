package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Types ─────────────────────────────────────────────────────

// AnalysisRequest from the MCP server.
type AnalysisRequest struct {
	Perspectives []PerspectiveRequest `json:"perspectives"`
	Tier         string               `json:"tier"`       // "free" | "pro"
	UserAddress  string               `json:"userAddress"` // g1... address for PRO credit check
}

// PerspectiveRequest is a single perspective analysis request.
type PerspectiveRequest struct {
	Perspective  string `json:"perspective"`
	ProposalData string `json:"proposalData"`
	DaoContext   string `json:"daoContext"`
	Treasury     string `json:"treasuryContext,omitempty"`
	// SystemPrompt and UserPrompt are the preferred way to pass prompts.
	// If set, ProposalData is ignored and these are used directly.
	SystemPrompt string `json:"systemPrompt,omitempty"`
	UserPrompt   string `json:"userPrompt,omitempty"`
}

// AnalysisResponse returned to the MCP server.
type AnalysisResponse struct {
	Results          []PerspectiveResult `json:"results"`
	ModelsUsed       []string            `json:"modelsUsed"`
	ProcessingTimeMs int64               `json:"processingTimeMs"`
	Tier             string              `json:"tier"`                // effective tier used
	Downgraded       bool                `json:"downgraded,omitempty"` // true if PRO was requested but credits insufficient
}

// PerspectiveResult is one LLM's analysis for one perspective.
type PerspectiveResult struct {
	Perspective     string   `json:"perspective"`
	Model           string   `json:"model"`
	Verdict         string   `json:"verdict"`
	Confidence      float64  `json:"confidence"`
	Reasoning       string   `json:"reasoning"`
	Risks           []string `json:"risks"`
	Recommendations []string `json:"recommendations"`
}

// ── Tier Enforcement ──────────────────────────────────────────

const (
	// Agent ID as registered in the on-chain agent_registry.
	daoAnalystAgentID = "dao-analyst"

	// Free tier limits.
	freeTierMaxPerspectives = 2
	proTierMaxPerspectives  = 5
)

// checkProCredits queries the on-chain agent_registry for a user's credit balance.
// Returns the credit balance in ugnot, or 0 if the query fails.
func checkProCredits(userAddr string) int64 {
	if userAddr == "" {
		return 0
	}

	registryPath := os.Getenv("AGENT_REGISTRY_REALM")
	if registryPath == "" {
		registryPath = "gno.land/r/samcrew/agent_registry"
	}

	expr := fmt.Sprintf(`GetCredits(%q, %q)`, daoAnalystAgentID, userAddr)
	result, err := abciQuery(gnoRPCURL(), "vm/qeval", registryPath+"\n"+expr)
	if err != nil {
		slog.Warn("failed to check pro credits", "user", userAddr, "error", err)
		return 0
	}

	// Parse qeval response: ("12345" int64)
	result = strings.TrimSpace(result)
	result = strings.TrimPrefix(result, "(")
	result = strings.TrimSuffix(result, ")")

	// Extract the quoted value
	if idx := strings.Index(result, `"`); idx >= 0 {
		end := strings.Index(result[idx+1:], `"`)
		if end >= 0 {
			valStr := result[idx+1 : idx+1+end]
			var val int64
			if _, err := fmt.Sscan(valStr, &val); err == nil {
				return val
			}
		}
	}

	return 0
}

// enforceTier validates and adjusts the request based on the user's tier.
// Returns the effective tier ("free" or "pro") and whether the request is allowed.
func enforceTier(req *AnalysisRequest) (effectiveTier string, downgraded bool) {
	if req.Tier != "pro" {
		// Free tier — cap perspectives
		if len(req.Perspectives) > freeTierMaxPerspectives {
			req.Perspectives = req.Perspectives[:freeTierMaxPerspectives]
		}
		return "free", false
	}

	// PRO requested — check credits on-chain
	credits := checkProCredits(req.UserAddress)
	if credits <= 0 {
		// No credits — downgrade to free
		slog.Info("pro tier requested but no credits, downgrading",
			"user", req.UserAddress, "credits", credits)
		if len(req.Perspectives) > freeTierMaxPerspectives {
			req.Perspectives = req.Perspectives[:freeTierMaxPerspectives]
		}
		return "free", true
	}

	// PRO with credits — allow full analysis
	if len(req.Perspectives) > proTierMaxPerspectives {
		req.Perspectives = req.Perspectives[:proTierMaxPerspectives]
	}
	return "pro", false
}

// ── LLM Provider Interface ────────────────────────────────────

// LLMProvider represents a free-tier LLM API.
type LLMProvider struct {
	Name    string
	Model   string
	BaseURL string
	APIKey  string
}

// LLMRequest is the common chat completion format.
type LLMRequest struct {
	Model       string       `json:"model"`
	Messages    []LLMMessage `json:"messages"`
	Temperature float64      `json:"temperature"`
	MaxTokens   int          `json:"max_tokens,omitempty"`
}

// LLMMessage is a chat message.
type LLMMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// LLMResponse is the common chat completion response.
type LLMResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	// Google AI uses a different format — handled in callGoogleAI
}

// ── Provider Registry ─────────────────────────────────────────

func getProviders() []LLMProvider {
	var providers []LLMProvider

	if key := os.Getenv("GROQ_API_KEY"); key != "" {
		providers = append(providers, LLMProvider{
			Name:    "groq",
			Model:   "llama-3.3-70b-versatile",
			BaseURL: "https://api.groq.com/openai/v1",
			APIKey:  key,
		})
	}

	if key := os.Getenv("GOOGLE_AI_KEY"); key != "" {
		providers = append(providers, LLMProvider{
			Name:    "google",
			Model:   "gemini-2.0-flash",
			BaseURL: "https://generativelanguage.googleapis.com/v1beta",
			APIKey:  key,
		})
	}

	if key := os.Getenv("TOGETHER_API_KEY"); key != "" {
		providers = append(providers, LLMProvider{
			Name:    "together",
			Model:   "mistralai/Mistral-7B-Instruct-v0.3",
			BaseURL: "https://api.together.xyz/v1",
			APIKey:  key,
		})
	}

	// Ollama — local fallback (lowest priority)
	if url := os.Getenv("OLLAMA_URL"); url != "" {
		model := os.Getenv("OLLAMA_MODEL")
		if model == "" {
			model = "llama3.2"
		}
		providers = append(providers, LLMProvider{
			Name:    "ollama",
			Model:   model,
			BaseURL: url,
			APIKey:  "", // no auth for local Ollama
		})
	}

	return providers
}

// ── LLM Calls ─────────────────────────────────────────────────

func callLLM(ctx context.Context, provider LLMProvider, systemPrompt, userPrompt string) (string, error) {
	switch provider.Name {
	case "google":
		return callGoogleAI(ctx, provider, systemPrompt, userPrompt)
	case "ollama":
		return callOllama(ctx, provider, systemPrompt, userPrompt)
	default:
		return callOpenAICompatible(ctx, provider, systemPrompt, userPrompt)
	}
}

// callOpenAICompatible works for Groq and Together.ai (OpenAI-compatible APIs).
func callOpenAICompatible(ctx context.Context, provider LLMProvider, systemPrompt, userPrompt string) (string, error) {
	reqBody := LLMRequest{
		Model: provider.Model,
		Messages: []LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.3,
		MaxTokens:   1024,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		provider.BaseURL+"/chat/completions",
		strings.NewReader(string(bodyBytes)),
	)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			var secs int
			if _, err := fmt.Sscan(ra, &secs); err == nil && secs > 0 {
				health.setRetryAfter(provider.Name, time.Now().Add(time.Duration(secs)*time.Second))
			}
		}
		return "", fmt.Errorf("rate limited (429): %s", string(body))
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("llm returned %d: %s", resp.StatusCode, string(body))
	}

	var llmResp LLMResponse
	if err := json.Unmarshal(body, &llmResp); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}

	if len(llmResp.Choices) == 0 || llmResp.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("empty LLM response")
	}

	return llmResp.Choices[0].Message.Content, nil
}

// callGoogleAI uses the Google AI Studio / Gemini API format.
func callGoogleAI(ctx context.Context, provider LLMProvider, systemPrompt, userPrompt string) (string, error) {
	type Part struct {
		Text string `json:"text"`
	}
	type Content struct {
		Role  string `json:"role,omitempty"`
		Parts []Part `json:"parts"`
	}
	type SystemInstruction struct {
		Parts []Part `json:"parts"`
	}
	type GenConfig struct {
		Temperature float64 `json:"temperature"`
		MaxTokens   int     `json:"maxOutputTokens"`
	}
	type GeminiReq struct {
		SystemInstruction *SystemInstruction `json:"systemInstruction,omitempty"`
		Contents          []Content          `json:"contents"`
		GenerationConfig  GenConfig          `json:"generationConfig"`
	}

	reqBody := GeminiReq{
		SystemInstruction: &SystemInstruction{Parts: []Part{{Text: systemPrompt}}},
		Contents: []Content{
			{Role: "user", Parts: []Part{{Text: userPrompt}}},
		},
		GenerationConfig: GenConfig{Temperature: 0.3, MaxTokens: 1024},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf(
		"%s/models/%s:generateContent",
		provider.BaseURL, provider.Model,
	)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", provider.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini returned %d: %s", resp.StatusCode, string(body))
	}

	// Parse Gemini response format
	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return "", fmt.Errorf("parse Gemini response: %w", err)
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty Gemini response")
	}

	return geminiResp.Candidates[0].Content.Parts[0].Text, nil
}

// callOllama uses the Ollama /api/chat endpoint.
func callOllama(ctx context.Context, provider LLMProvider, systemPrompt, userPrompt string) (string, error) {
	type OllamaMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type OllamaReq struct {
		Model    string          `json:"model"`
		Messages []OllamaMessage `json:"messages"`
		Stream   bool            `json:"stream"`
	}

	reqBody := OllamaReq{
		Model: provider.Model,
		Messages: []OllamaMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream: false,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second) // Ollama can be slow
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		provider.BaseURL+"/api/chat",
		strings.NewReader(string(bodyBytes)),
	)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(body))
	}

	var ollamaResp struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return "", fmt.Errorf("parse Ollama response: %w", err)
	}

	if ollamaResp.Message.Content == "" {
		return "", fmt.Errorf("empty Ollama response")
	}

	return ollamaResp.Message.Content, nil
}

// ── Analysis Handler ──────────────────────────────────────────

// HandleAnalystAnalyze handles POST /api/analyst/analyze
// Routes each perspective to a different LLM provider for model diversity.
func HandleAnalystAnalyze() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, 512*1024)) // 512KB max
		if err != nil {
			http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
			return
		}

		var req AnalysisRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}

		if len(req.Perspectives) == 0 {
			http.Error(w, `{"error":"no perspectives provided"}`, http.StatusBadRequest)
			return
		}

		if len(req.Perspectives) > 5 {
			http.Error(w, `{"error":"max 5 perspectives"}`, http.StatusBadRequest)
			return
		}

		// Enforce tier — checks on-chain credits for PRO
		effectiveTier, downgraded := enforceTier(&req)

		providers := getProviders()
		if len(providers) == 0 {
			slog.Error("no LLM providers configured — set GROQ_API_KEY, GOOGLE_AI_KEY, or TOGETHER_API_KEY")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = fmt.Fprint(w, `{"error":"no LLM providers configured on backend"}`)
			return
		}

		start := time.Now()
		results := make([]PerspectiveResult, len(req.Perspectives))
		modelsUsed := make([]string, len(req.Perspectives))

		// Fan out perspectives to different providers in parallel.
		// Each perspective gets a different provider for model diversity.
		// Circuit breaker skips unhealthy providers automatically.
		var wg sync.WaitGroup
		for i, perspective := range req.Perspectives {
			wg.Add(1)
			go func(idx int, p PerspectiveRequest) {
				defer wg.Done()

				// Select healthy provider via round-robin
				provider, providerIdx := selectProvider(providers, idx)
				modelsUsed[idx] = provider.Name + "/" + provider.Model

				// Prefer explicit system/user prompts; fall back to legacy split
			system, user := p.SystemPrompt, p.UserPrompt
			if system == "" && user == "" {
				system, user = splitPrompt(p.ProposalData)
			}

				llmOutput, err := callLLM(r.Context(), provider, system, user)
				if err != nil {
					health.recordFailure(provider.Name)
					slog.Warn("LLM call failed",
						"perspective", p.Perspective,
						"provider", provider.Name,
						"error", err,
					)

					// Try fallback provider
					if fallback, ok := selectFallback(providers, providerIdx); ok {
						modelsUsed[idx] = fallback.Name + "/" + fallback.Model
						llmOutput, err = callLLM(r.Context(), fallback, system, user)
						if err != nil {
							health.recordFailure(fallback.Name)
						} else {
							health.recordSuccess(fallback.Name)
						}
					}

					if err != nil {
						results[idx] = PerspectiveResult{
							Perspective: p.Perspective,
							Model:       modelsUsed[idx],
							Verdict:     "abstain",
							Confidence:  0,
							Reasoning:   fmt.Sprintf("LLM call failed: %s", err),
							Risks:       []string{"Analysis unavailable due to provider error"},
						}
						return
					}
				} else {
					health.recordSuccess(provider.Name)
				}

				results[idx] = parseLLMOutput(llmOutput, p.Perspective, modelsUsed[idx])
			}(i, perspective)
		}

		wg.Wait()

		resp := AnalysisResponse{
			Results:          results,
			ModelsUsed:       modelsUsed,
			ProcessingTimeMs: time.Since(start).Milliseconds(),
			Tier:             effectiveTier,
			Downgraded:       downgraded,
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("failed to write analyst response", "error", err)
		}
	})
}

// splitPrompt splits the combined prompt into system and user parts.
// The MCP server sends them concatenated with a double newline separator.
func splitPrompt(combined string) (system, user string) {
	parts := strings.SplitN(combined, "\n\n", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", combined
}

// parseLLMOutput attempts to parse structured JSON from LLM output.
func parseLLMOutput(raw, perspective, model string) PerspectiveResult {
	// Strip markdown code fences
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	var parsed struct {
		Verdict         string   `json:"verdict"`
		Confidence      float64  `json:"confidence"`
		Reasoning       string   `json:"reasoning"`
		Risks           []string `json:"risks"`
		Recommendations []string `json:"recommendations"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		// Non-JSON response — wrap as reasoning
		return PerspectiveResult{
			Perspective:     perspective,
			Model:           model,
			Verdict:         "abstain",
			Confidence:      0.3,
			Reasoning:       truncate(raw, 500),
			Risks:           []string{"LLM response was not structured JSON"},
			Recommendations: nil,
		}
	}

	// Validate verdict
	switch parsed.Verdict {
	case "approve", "reject", "caution", "abstain":
	default:
		parsed.Verdict = "abstain"
	}

	// Clamp confidence
	if parsed.Confidence < 0 {
		parsed.Confidence = 0
	}
	if parsed.Confidence > 1 {
		parsed.Confidence = 1
	}

	return PerspectiveResult{
		Perspective:     perspective,
		Model:           model,
		Verdict:         parsed.Verdict,
		Confidence:      parsed.Confidence,
		Reasoning:       parsed.Reasoning,
		Risks:           parsed.Risks,
		Recommendations: parsed.Recommendations,
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

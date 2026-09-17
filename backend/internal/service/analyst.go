package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// ── Types ─────────────────────────────────────────────────────

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

// ── LLM Provider Interface ────────────────────────────────────

// LLMProvider represents a free-tier LLM API.
type LLMProvider struct {
	Name        string
	Model       string
	BaseURL     string
	APIKey      string
	DisplayName string // Human-readable name for UI (OpenRouter models)
	Role        string // Governance perspective role (OpenRouter models)
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

	// OpenRouter — 10 free models for multi-model consensus
	if key := os.Getenv("OPENROUTER_API_KEY"); key != "" {
		for _, m := range getOpenRouterModels() {
			providers = append(providers, LLMProvider{
				Name:        "openrouter-" + m.ShortName,
				Model:       m.ModelID,
				BaseURL:     "https://openrouter.ai/api/v1",
				APIKey:      key,
				DisplayName: m.DisplayName,
				Role:        m.Role,
			})
		}
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
	// For OpenRouter: merge system + user into a single user message
	// to avoid "Developer instruction is not enabled" errors on models
	// routed through providers that don't support system prompts (e.g. Gemma via Google AI Studio).
	var messages []LLMMessage
	if strings.HasPrefix(provider.Name, "openrouter-") {
		messages = []LLMMessage{
			{Role: "user", Content: systemPrompt + "\n\n" + userPrompt},
		}
	} else {
		messages = []LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		}
	}

	reqBody := LLMRequest{
		Model:       provider.Model,
		Messages:    messages,
		Temperature: 0.3,
		MaxTokens:   1024,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	// 20s timeout for OpenRouter free models (they should respond in <10s)
	// 30s timeout for other providers (Groq, Together, etc.)
	timeout := 30 * time.Second
	if strings.HasPrefix(provider.Name, "openrouter-") {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
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

	// OpenRouter requires additional headers
	if strings.HasPrefix(provider.Name, "openrouter-") {
		req.Header.Set("HTTP-Referer", "https://memba.samourai.app")
		req.Header.Set("X-Title", "Memba DAO Analyst")
	}

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

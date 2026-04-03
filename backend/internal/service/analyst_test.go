package service

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSplitPrompt(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantSystem string
		wantUser   string
	}{
		{
			name:       "splits on double newline",
			input:      "system prompt\n\nuser prompt",
			wantSystem: "system prompt",
			wantUser:   "user prompt",
		},
		{
			name:       "no separator returns empty system",
			input:      "just user content",
			wantSystem: "",
			wantUser:   "just user content",
		},
		{
			name:       "multiple separators splits on first",
			input:      "system\n\nuser line 1\n\nuser line 2",
			wantSystem: "system",
			wantUser:   "user line 1\n\nuser line 2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			system, user := splitPrompt(tt.input)
			if system != tt.wantSystem {
				t.Errorf("system: got %q, want %q", system, tt.wantSystem)
			}
			if user != tt.wantUser {
				t.Errorf("user: got %q, want %q", user, tt.wantUser)
			}
		})
	}
}

func TestParseLLMOutput(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantV   string
		wantC   float64
		wantErr bool
	}{
		{
			name: "valid JSON response",
			raw: `{"verdict":"approve","confidence":0.85,"reasoning":"Looks good",
				"risks":["risk1"],"recommendations":["rec1"]}`,
			wantV: "approve",
			wantC: 0.85,
		},
		{
			name: "JSON in code fence",
			raw: "```json\n{\"verdict\":\"reject\",\"confidence\":0.9,\"reasoning\":\"Bad\",\"risks\":[],\"recommendations\":[]}\n```",
			wantV: "reject",
			wantC: 0.9,
		},
		{
			name:  "non-JSON response",
			raw:   "I think this proposal is good because...",
			wantV: "abstain",
			wantC: 0.3,
		},
		{
			name: "invalid verdict defaults to abstain",
			raw:  `{"verdict":"maybe","confidence":0.5,"reasoning":"Unsure","risks":[],"recommendations":[]}`,
			wantV: "abstain",
			wantC: 0.5,
		},
		{
			name: "clamps confidence above 1",
			raw:  `{"verdict":"approve","confidence":1.5,"reasoning":"Very sure","risks":[],"recommendations":[]}`,
			wantV: "approve",
			wantC: 1.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseLLMOutput(tt.raw, "technical", "test-model")
			if result.Verdict != tt.wantV {
				t.Errorf("verdict: got %q, want %q", result.Verdict, tt.wantV)
			}
			if result.Confidence != tt.wantC {
				t.Errorf("confidence: got %f, want %f", result.Confidence, tt.wantC)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate("hello", 10); got != "hello" {
		t.Errorf("short string: got %q", got)
	}
	if got := truncate("hello world", 5); got != "hello..." {
		t.Errorf("long string: got %q", got)
	}
}

func TestHandleAnalystAnalyze_BadMethod(t *testing.T) {
	handler := HandleAnalystAnalyze()
	req := httptest.NewRequest(http.MethodGet, "/api/analyst/analyze", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestHandleAnalystAnalyze_EmptyBody(t *testing.T) {
	handler := HandleAnalystAnalyze()
	req := httptest.NewRequest(http.MethodPost, "/api/analyst/analyze", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAnalystAnalyze_TooManyPerspectives(t *testing.T) {
	handler := HandleAnalystAnalyze()

	reqBody := AnalysisRequest{
		Perspectives: make([]PerspectiveRequest, 6),
		Tier:         "free",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/analyst/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAnalystAnalyze_NoProviders(t *testing.T) {
	// Ensure no API keys are set
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("GOOGLE_AI_KEY", "")
	t.Setenv("TOGETHER_API_KEY", "")

	handler := HandleAnalystAnalyze()

	reqBody := AnalysisRequest{
		Perspectives: []PerspectiveRequest{
			{Perspective: "technical", ProposalData: "test", DaoContext: "test"},
		},
		Tier: "free",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/analyst/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}
}

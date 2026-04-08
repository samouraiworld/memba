package service

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
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

// ── Tier Enforcement Tests ──────────────────────────────────

func TestEnforceTier_Free(t *testing.T) {
	req := &AnalysisRequest{
		Perspectives: make([]PerspectiveRequest, 5),
		Tier:         "free",
	}

	tier, downgraded := enforceTier(req)
	if tier != "free" {
		t.Errorf("expected free tier, got %s", tier)
	}
	if downgraded {
		t.Error("should not be downgraded for free tier")
	}
	if len(req.Perspectives) != freeTierMaxPerspectives {
		t.Errorf("expected %d perspectives, got %d", freeTierMaxPerspectives, len(req.Perspectives))
	}
}

func TestEnforceTier_FreeFewPerspectives(t *testing.T) {
	req := &AnalysisRequest{
		Perspectives: make([]PerspectiveRequest, 1),
		Tier:         "free",
	}

	enforceTier(req)
	if len(req.Perspectives) != 1 {
		t.Errorf("should not truncate when under limit, got %d", len(req.Perspectives))
	}
}

func TestEnforceTier_ProNoCredits(t *testing.T) {
	// No user address = no credits = downgrade
	req := &AnalysisRequest{
		Perspectives: make([]PerspectiveRequest, 3),
		Tier:         "pro",
		UserAddress:  "",
	}

	tier, downgraded := enforceTier(req)
	if tier != "free" {
		t.Errorf("expected free (downgraded), got %s", tier)
	}
	if !downgraded {
		t.Error("should be downgraded when no credits")
	}
	if len(req.Perspectives) != freeTierMaxPerspectives {
		t.Errorf("expected %d perspectives after downgrade, got %d", freeTierMaxPerspectives, len(req.Perspectives))
	}
}

// ── Consensus Validation Tests ─────────────────────────────

func TestValidateConsensusRequest_ProposalIDZero(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "proposal",
		ProposalID:   0,
		ProposalData: "test data",
	}
	if err := validateConsensusRequest(req); err != nil {
		t.Errorf("proposal ID 0 should be valid, got error: %v", err)
	}
}

func TestValidateConsensusRequest_ProposalIDPositive(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "proposal",
		ProposalID:   15,
		ProposalData: "test data",
	}
	if err := validateConsensusRequest(req); err != nil {
		t.Errorf("proposal ID 15 should be valid, got error: %v", err)
	}
}

func TestValidateConsensusRequest_ProposalIDNegative(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "proposal",
		ProposalID:   -1,
		ProposalData: "test data",
	}
	if err := validateConsensusRequest(req); err == nil {
		t.Error("negative proposal ID should be rejected")
	}
}

func TestValidateConsensusRequest_DAOAnalysisAllowsZero(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "dao",
		ProposalID:   0,
		ProposalData: "test data",
	}
	if err := validateConsensusRequest(req); err != nil {
		t.Errorf("DAO analysis with proposalId 0 should be valid, got error: %v", err)
	}
}

func TestValidateConsensusRequest_InvalidRealmPath(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "invalid/path",
		AnalysisType: "proposal",
		ProposalID:   1,
		ProposalData: "test",
	}
	if err := validateConsensusRequest(req); err == nil {
		t.Error("invalid realm path should be rejected")
	}
}

func TestValidateConsensusRequest_ProposalDataTooLarge(t *testing.T) {
	req := &ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "proposal",
		ProposalID:   1,
		ProposalData: string(make([]byte, 51*1024)),
	}
	if err := validateConsensusRequest(req); err == nil {
		t.Error("oversized proposalData should be rejected")
	}
}

func TestHandleAnalystConsensus_BadMethod(t *testing.T) {
	handler := HandleAnalystConsensus(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/analyst/consensus", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestHandleAnalystConsensus_InvalidJSON(t *testing.T) {
	handler := HandleAnalystConsensus(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAnalystConsensus_ProposalZeroValidation(t *testing.T) {
	// Proposal ID 0 should pass validation (not return 400).
	// Use in-memory DB so the handler can check cache without panicking.
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal("open db:", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	// Clear all LLM keys so the handler returns 503 (no providers) after validation passes.
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("GOOGLE_AI_KEY", "")
	t.Setenv("TOGETHER_API_KEY", "")

	handler := HandleAnalystConsensus(database)
	reqBody := ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		AnalysisType: "proposal",
		ProposalID:   0,
		ProposalData: "test proposal data",
		DAOContext:   "test context",
		ChainID:      "test11",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Should NOT be 400 — validation passes. Expect 503 (no providers configured).
	if rec.Code == http.StatusBadRequest {
		t.Errorf("proposal ID 0 should not cause 400 validation error, got body: %s", rec.Body.String())
	}
}

func TestEnforceTier_ProWithInvalidAddress(t *testing.T) {
	// Invalid address = checkProCredits returns 0 = downgrade
	req := &AnalysisRequest{
		Perspectives: make([]PerspectiveRequest, 3),
		Tier:         "pro",
		UserAddress:  "g1invalid",
	}

	tier, downgraded := enforceTier(req)
	if tier != "free" {
		t.Errorf("expected free (downgraded), got %s", tier)
	}
	if !downgraded {
		t.Error("should be downgraded with invalid address")
	}
}

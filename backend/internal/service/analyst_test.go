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

// ── Tier Enforcement Tests ──────────────────────────────────

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
		ChainID:      "pearl-1",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(WithAuthAddress(req.Context(), "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Validation passes; with no providers configured the handler answers 503.
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("proposal ID 0: want 503 (no providers), got %d body: %s", rec.Code, rec.Body.String())
	}
}

// ── Consensus Aggregation (A3: responder-only math) ─────────

func TestAggregateConsensus(t *testing.T) {
	mk := func(verdict string, conf float64, responded bool) ConsensusPerspective {
		// "Governance Expert" has weight 1.0, keeping the arithmetic simple.
		return ConsensusPerspective{Role: "Governance Expert", Verdict: verdict, Confidence: conf, Responded: responded}
	}

	t.Run("failed models are excluded from agreement and confidence", func(t *testing.T) {
		var ps []ConsensusPerspective
		for range 8 {
			ps = append(ps, mk("approve", 0.8, true)) // 8 genuine approvals
		}
		ps = append(ps, mk("abstain", 0, false)) // 2 failed calls
		ps = append(ps, mk("abstain", 0, false))

		v := aggregateConsensus(ps)
		if v.Verdict != "approve" {
			t.Errorf("verdict: got %q, want approve", v.Verdict)
		}
		if v.RespondedCount != 8 {
			t.Errorf("respondedCount: got %d, want 8", v.RespondedCount)
		}
		if v.TotalCount != 10 {
			t.Errorf("totalCount: got %d, want 10", v.TotalCount)
		}
		if v.AgreeCount != 8 {
			t.Errorf("agreeCount: got %d, want 8", v.AgreeCount)
		}
		// 8/8 responders agree → unanimous, not "strong" (which 8/10 would give)
		if v.AgreementLevel != "unanimous" {
			t.Errorf("agreementLevel: got %q, want unanimous", v.AgreementLevel)
		}
		// confidence is the responders' average (0.80), not dragged to 0.64 by failures
		if v.Confidence < 0.79 || v.Confidence > 0.81 {
			t.Errorf("confidence: got %v, want ~0.80", v.Confidence)
		}
	})

	t.Run("all models failed → abstain, zero responded", func(t *testing.T) {
		v := aggregateConsensus([]ConsensusPerspective{
			mk("abstain", 0, false),
			mk("abstain", 0, false),
		})
		if v.Verdict != "abstain" {
			t.Errorf("verdict: got %q, want abstain", v.Verdict)
		}
		if v.RespondedCount != 0 {
			t.Errorf("respondedCount: got %d, want 0", v.RespondedCount)
		}
		if v.TotalCount != 2 {
			t.Errorf("totalCount: got %d, want 2", v.TotalCount)
		}
	})

	t.Run("empty input → abstain", func(t *testing.T) {
		if v := aggregateConsensus(nil); v.Verdict != "abstain" {
			t.Errorf("verdict: got %q, want abstain", v.Verdict)
		}
	})
}

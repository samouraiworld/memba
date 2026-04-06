package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ── Consensus Types ──────────────────────────────────────────

// ConsensusRequest from the frontend.
type ConsensusRequest struct {
	RealmPath       string `json:"realmPath"`
	ProposalID      int    `json:"proposalId"`
	ProposalData    string `json:"proposalData"`
	DAOContext      string `json:"daoContext"`
	TreasuryContext string `json:"treasuryContext,omitempty"`
}

// ConsensusResponse returned to the frontend.
type ConsensusResponse struct {
	Consensus    ConsensusVerdict      `json:"consensus"`
	Perspectives []ConsensusPerspective `json:"perspectives"`
	ProcessingMs int64                  `json:"processingTimeMs"`
	Cached       bool                   `json:"cached"`
	ExpiresAt    string                 `json:"expiresAt,omitempty"`
}

// ConsensusVerdict is the aggregated multi-model verdict.
type ConsensusVerdict struct {
	Verdict            string   `json:"verdict"`
	Confidence         float64  `json:"confidence"`
	AgreementLevel     string   `json:"agreementLevel"`
	AgreeCount         int      `json:"agreeCount"`
	TotalCount         int      `json:"totalCount"`
	Summary            string   `json:"summary"`
	KeyRisks           []string `json:"keyRisks"`
	KeyRecommendations []string `json:"keyRecommendations"`
}

// ConsensusPerspective is one model's analysis result.
type ConsensusPerspective struct {
	Model           string   `json:"model"`
	DisplayName     string   `json:"displayName"`
	Role            string   `json:"role"`
	Verdict         string   `json:"verdict"`
	Confidence      float64  `json:"confidence"`
	Reasoning       string   `json:"reasoning"`
	Risks           []string `json:"risks"`
	Recommendations []string `json:"recommendations"`
}

// ── Input Validation ─────────────────────────────────────────

var validRealmPath = regexp.MustCompile(`^gno\.land/[rp]/[\w/]+$`)

func validateConsensusRequest(req *ConsensusRequest) error {
	if !validRealmPath.MatchString(req.RealmPath) {
		return fmt.Errorf("invalid realm path")
	}
	if req.ProposalID <= 0 {
		return fmt.Errorf("proposalId must be positive")
	}
	if len(req.ProposalData) > 50*1024 {
		return fmt.Errorf("proposalData exceeds 50KB limit")
	}
	if len(req.DAOContext) > 10*1024 {
		return fmt.Errorf("daoContext exceeds 10KB limit")
	}
	return nil
}

// ── Cache ────────────────────────────────────────────────────

func getDefaultCacheTTL() time.Duration {
	if ttl := os.Getenv("ANALYST_CACHE_TTL"); ttl != "" {
		if d, err := time.ParseDuration(ttl); err == nil {
			return d
		}
	}
	return 6 * time.Hour
}

func getCachedConsensus(db *sql.DB, realmPath string, proposalID int) (*ConsensusResponse, error) {
	var consensusJSON string
	var expiresAt time.Time

	err := db.QueryRow(
		`SELECT consensus, expires_at FROM analyst_reports WHERE realm_path = ? AND proposal_id = ? AND expires_at > ?`,
		realmPath, proposalID, time.Now().UTC(),
	).Scan(&consensusJSON, &expiresAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var resp ConsensusResponse
	if err := json.Unmarshal([]byte(consensusJSON), &resp); err != nil {
		return nil, err
	}
	resp.Cached = true
	resp.ExpiresAt = expiresAt.Format(time.RFC3339)
	return &resp, nil
}

func cacheConsensus(db *sql.DB, realmPath string, proposalID int, resp *ConsensusResponse) {
	ttl := getDefaultCacheTTL()
	expiresAt := time.Now().UTC().Add(ttl)

	respJSON, err := json.Marshal(resp)
	if err != nil {
		slog.Warn("failed to marshal consensus for cache", "error", err)
		return
	}

	_, err = db.Exec(
		`INSERT OR REPLACE INTO analyst_reports (realm_path, proposal_id, consensus, expires_at) VALUES (?, ?, ?, ?)`,
		realmPath, proposalID, string(respJSON), expiresAt,
	)
	if err != nil {
		slog.Warn("failed to cache consensus", "error", err)
	}
}

// ── Perspective Weights ──────────────────────────────────────

var perspectiveWeights = map[string]float64{
	"Strategic Thinker":    1.1,
	"Risk Scout":           1.2,
	"Deep Reasoning":       1.3,
	"Technical Analyst":    1.2,
	"Financial Perspective": 1.2,
	"Community Impact":     0.9,
	"Regulatory / Legal":   1.0,
	"Security Auditor":     1.2,
	"Governance Expert":    1.0,
	"Devil's Advocate":     0.7, // contrarian: dissent voice, shouldn't swing the vote
}

// ── Consensus Aggregation ────────────────────────────────────

func aggregateConsensus(perspectives []ConsensusPerspective) ConsensusVerdict {
	if len(perspectives) == 0 {
		return ConsensusVerdict{
			Verdict:        "abstain",
			Confidence:     0,
			AgreementLevel: "contested",
			Summary:        "No analysis results available.",
		}
	}

	// Weighted verdict scoring
	scores := map[string]float64{"approve": 0, "reject": 0, "caution": 0, "abstain": 0}
	totalWeight := 0.0

	for _, p := range perspectives {
		w := perspectiveWeights[p.Role]
		if w == 0 {
			w = 1.0
		}
		scores[p.Verdict] += w * p.Confidence
		totalWeight += w
	}

	// Find winning verdict
	verdict := "abstain"
	maxScore := -1.0
	for v, s := range scores {
		if s > maxScore {
			maxScore = s
			verdict = v
		}
	}

	// Count agreement with winning verdict
	agreeCount := 0
	for _, p := range perspectives {
		if p.Verdict == verdict {
			agreeCount++
		}
	}

	// Weighted confidence
	weightedSum := 0.0
	weightTotal := 0.0
	for _, p := range perspectives {
		w := perspectiveWeights[p.Role]
		if w == 0 {
			w = 1.0
		}
		weightedSum += p.Confidence * w
		weightTotal += w
	}
	completeness := math.Min(float64(len(perspectives))/10.0, 1.0)
	confidence := 0.0
	if weightTotal > 0 {
		confidence = (weightedSum / weightTotal) * completeness
	}
	confidence = math.Round(confidence*100) / 100

	// Agreement level
	ratio := float64(agreeCount) / float64(len(perspectives))
	agreementLevel := "contested"
	if ratio >= 1.0 {
		agreementLevel = "unanimous"
	} else if ratio >= 0.75 {
		agreementLevel = "strong"
	} else if ratio >= 0.5 {
		agreementLevel = "split"
	}

	// Collect and deduplicate risks/recommendations
	riskSet := make(map[string]bool)
	var risks []string
	recSet := make(map[string]bool)
	var recs []string

	for _, p := range perspectives {
		for _, r := range p.Risks {
			key := strings.ToLower(strings.TrimSpace(r))
			if !riskSet[key] && key != "" {
				riskSet[key] = true
				risks = append(risks, strings.TrimSpace(r))
			}
		}
		for _, r := range p.Recommendations {
			key := strings.ToLower(strings.TrimSpace(r))
			if !recSet[key] && key != "" {
				recSet[key] = true
				recs = append(recs, strings.TrimSpace(r))
			}
		}
	}
	if len(risks) > 10 {
		risks = risks[:10]
	}
	if len(recs) > 10 {
		recs = recs[:10]
	}

	// Build summary
	verdictText := map[string]string{
		"approve": "The proposal is recommended for approval",
		"reject":  "The proposal is not recommended",
		"caution": "The proposal warrants caution",
		"abstain": "Insufficient data to form a recommendation",
	}
	agreementText := map[string]string{
		"unanimous": "All models unanimously agree.",
		"strong":    "Strong agreement across models.",
		"split":     "Models are split — significant disagreement.",
		"contested": "Models strongly disagree — thorough review recommended.",
	}

	summary := fmt.Sprintf("%s (confidence: %d%%). %s %d/%d models agree.",
		verdictText[verdict], int(confidence*100), agreementText[agreementLevel],
		agreeCount, len(perspectives))

	return ConsensusVerdict{
		Verdict:            verdict,
		Confidence:         confidence,
		AgreementLevel:     agreementLevel,
		AgreeCount:         agreeCount,
		TotalCount:         len(perspectives),
		Summary:            summary,
		KeyRisks:           risks,
		KeyRecommendations: recs,
	}
}

// ── Handler ──────────────────────────────────────────────────

// HandleAnalystConsensus handles POST /api/analyst/consensus.
// Fans out to 10 OpenRouter models (2 batches of 5), aggregates, caches.
func HandleAnalystConsensus(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
			return
		}

		var req ConsensusRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}

		if err := validateConsensusRequest(&req); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
			return
		}

		// Check cache
		if cached, err := getCachedConsensus(db, req.RealmPath, req.ProposalID); err == nil && cached != nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(cached)
			return
		}

		// Select OpenRouter providers
		allProviders := getProviders()
		var orProviders []LLMProvider
		for _, p := range allProviders {
			if strings.HasPrefix(p.Name, "openrouter-") {
				orProviders = append(orProviders, p)
			}
		}

		// Fallback: use any available providers if no OpenRouter
		if len(orProviders) == 0 {
			orProviders = allProviders
		}

		if len(orProviders) == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = fmt.Fprint(w, `{"error":"no LLM providers configured"}`)
			return
		}

		start := time.Now()
		perspectives := make([]ConsensusPerspective, len(orProviders))

		// Build user prompt (same for all models)
		userPrompt := fmt.Sprintf(
			"<proposal_data>\n%s\n</proposal_data>\n\n<dao_context>\n%s\n</dao_context>",
			req.ProposalData, req.DAOContext,
		)
		if req.TreasuryContext != "" {
			userPrompt += fmt.Sprintf("\n\n<treasury_context>\n%s\n</treasury_context>", req.TreasuryContext)
		}

		// Fan out in 2 batches of 5 to respect 20 req/min rate limit
		batchSize := 5
		for batchStart := 0; batchStart < len(orProviders); batchStart += batchSize {
			batchEnd := batchStart + batchSize
			if batchEnd > len(orProviders) {
				batchEnd = len(orProviders)
			}

			var wg sync.WaitGroup
			for i := batchStart; i < batchEnd; i++ {
				wg.Add(1)
				go func(idx int, provider LLMProvider) {
					defer wg.Done()

					systemPrompt := perspectiveSystemPrompt(provider.Role)
					llmOutput, err := callLLM(r.Context(), provider, systemPrompt, userPrompt)

					if err != nil {
						health.recordFailure(provider.Name)
						slog.Warn("consensus LLM call failed",
							"provider", provider.Name,
							"role", provider.Role,
							"error", err,
						)
						perspectives[idx] = ConsensusPerspective{
							Model:       provider.Model,
							DisplayName: provider.DisplayName,
							Role:        provider.Role,
							Verdict:     "abstain",
							Confidence:  0,
							Reasoning:   fmt.Sprintf("Model unavailable: %s", err),
							Risks:       []string{"Analysis unavailable"},
						}
						return
					}
					health.recordSuccess(provider.Name)

					parsed := parseLLMOutput(llmOutput, provider.Role, provider.Model)
					perspectives[idx] = ConsensusPerspective{
						Model:           provider.Model,
						DisplayName:     provider.DisplayName,
						Role:            provider.Role,
						Verdict:         parsed.Verdict,
						Confidence:      parsed.Confidence,
						Reasoning:       parsed.Reasoning,
						Risks:           parsed.Risks,
						Recommendations: parsed.Recommendations,
					}
				}(i, orProviders[i])
			}
			wg.Wait()

			// Gap between batches (only if more batches remain)
			if batchEnd < len(orProviders) {
				select {
				case <-r.Context().Done():
					http.Error(w, `{"error":"request cancelled"}`, http.StatusRequestTimeout)
					return
				case <-time.After(3 * time.Second):
				}
			}
		}

		consensus := aggregateConsensus(perspectives)
		resp := ConsensusResponse{
			Consensus:    consensus,
			Perspectives: perspectives,
			ProcessingMs: time.Since(start).Milliseconds(),
			Cached:       false,
		}

		// Cache the result
		cacheConsensus(db, req.RealmPath, req.ProposalID, &resp)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
}

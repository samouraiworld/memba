package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
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
	ProposalID      int    `json:"proposalId"`            // 0 for DAO-level analysis
	AnalysisType    string `json:"analysisType,omitempty"` // "proposal" (default) or "dao"
	ChainID         string `json:"chainId,omitempty"`      // network key or chain ID; normalized to the chain ID
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
	// InputDigest identifies the inputs the report was generated from; together
	// with realm, analysis type, proposal and chain it addresses the cached row.
	InputDigest string `json:"inputDigest,omitempty"`
}

// ConsensusVerdict is the aggregated multi-model verdict.
type ConsensusVerdict struct {
	Verdict            string   `json:"verdict"`
	Confidence         float64  `json:"confidence"`
	AgreementLevel     string   `json:"agreementLevel"`
	AgreeCount         int      `json:"agreeCount"`
	RespondedCount     int      `json:"respondedCount"`
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
	Responded       bool     `json:"responded"` // false when the model call failed (excluded from consensus math)
}

// ── Input Validation ─────────────────────────────────────────

var validRealmPath = regexp.MustCompile(`^gno\.land/[rp]/[\w/]+$`)

// analystChainIDs maps every network key and chain ID a client may send to the
// canonical chain ID used for cache scoping and chain context. Anything else is
// rejected, so arbitrary strings never reach the cache key or the prompt.
var analystChainIDs = map[string]string{
	"mainnet":     "gnoland-1",
	"gnoland-1":   "gnoland-1",
	"gnoland1":    "gnoland1",
	"pearl":       "pearl-1",
	"pearl-1":     "pearl-1",
	"sapphire":    "sapphire-1",
	"sapphire-1":  "sapphire-1",
	"topaz":       "topaz-1",
	"topaz-1":     "topaz-1",
	"test13":      "test-13",
	"test-13":     "test-13",
	"portal-loop": "portal-loop",
	"staging":     "staging",
}

// resolveAnalystChainID returns the canonical chain ID for a network key or chain ID.
func resolveAnalystChainID(id string) (string, bool) {
	canonical, ok := analystChainIDs[id]
	return canonical, ok
}

func validateConsensusRequest(req *ConsensusRequest) error {
	if !validRealmPath.MatchString(req.RealmPath) {
		return fmt.Errorf("invalid realm path")
	}
	if req.ChainID != "" {
		canonical, ok := resolveAnalystChainID(req.ChainID)
		if !ok {
			return fmt.Errorf("unsupported chainId")
		}
		req.ChainID = canonical
	}
	// Normalize analysis type
	if req.AnalysisType == "" {
		req.AnalysisType = "proposal"
	}
	if req.AnalysisType != "proposal" && req.AnalysisType != "dao" {
		return fmt.Errorf("analysisType must be 'proposal' or 'dao'")
	}
	if req.AnalysisType == "proposal" && req.ProposalID < 0 {
		return fmt.Errorf("proposalId must be non-negative for proposal analysis")
	}
	if len(req.ProposalData) > 50*1024 {
		return fmt.Errorf("proposalData exceeds 50KB limit")
	}
	if len(req.DAOContext) > 10*1024 {
		return fmt.Errorf("daoContext exceeds 10KB limit")
	}
	if len(req.TreasuryContext) > 10*1024 {
		return fmt.Errorf("treasuryContext exceeds 10KB limit")
	}
	return nil
}

// consensusDataTag matches an opening or closing prompt delimiter, with any
// spacing, so caller-supplied data can neither end its own block early nor
// open a new one (for example a fake chain_context).
var consensusDataTag = regexp.MustCompile(`(?i)<\s*/?\s*(chain_context|proposal_data|dao_health_data|dao_context|treasury_context)\b`)

func neutralizeConsensusData(s string) string {
	return consensusDataTag.ReplaceAllStringFunc(s, func(m string) string {
		return "&lt;" + m[1:]
	})
}

// buildConsensusUserPrompt returns the user message shared by every model:
// server-written chain context, then each caller-supplied field as tagged,
// neutralized data. Model instructions stay in the server-owned system prompt.
func buildConsensusUserPrompt(req *ConsensusRequest) string {
	dataTag := "proposal_data"
	if req.AnalysisType == "dao" {
		dataTag = "dao_health_data"
	}
	var b strings.Builder
	b.WriteString("<chain_context>\n")
	b.WriteString(buildChainContext(req.ChainID))
	b.WriteString("\n</chain_context>\n\n<" + dataTag + ">\n")
	b.WriteString(neutralizeConsensusData(req.ProposalData))
	b.WriteString("\n</" + dataTag + ">\n\n<dao_context>\n")
	b.WriteString(neutralizeConsensusData(req.DAOContext))
	b.WriteString("\n</dao_context>")
	if req.TreasuryContext != "" {
		b.WriteString("\n\n<treasury_context>\n")
		b.WriteString(neutralizeConsensusData(req.TreasuryContext))
		b.WriteString("\n</treasury_context>")
	}
	return b.String()
}

// analystPromptVersion is folded into every input digest. Bump it whenever the
// prompts or the prompt layout change so reports generated under the previous
// prompts are no longer served.
const analystPromptVersion = "consensus-prompt-v2"

// consensusKey addresses one cached consensus report. A report is shared only
// with requests that supplied exactly the same inputs: the input digest binds
// the row to the analysis type and the facts the models were given.
type consensusKey struct {
	RealmPath    string
	AnalysisType string
	ProposalID   int
	ChainID      string
	InputDigest  string
}

// consensusInputDigest is a SHA-256 over the prompt version, analysis type and
// every caller-supplied fact placed in the prompt. Each part is length-prefixed
// so distinct inputs can never concatenate to the same byte stream.
func consensusInputDigest(req *ConsensusRequest) string {
	h := sha256.New()
	var n [8]byte
	for _, part := range []string{
		analystPromptVersion,
		req.AnalysisType,
		req.ProposalData,
		req.DAOContext,
		req.TreasuryContext,
	} {
		binary.BigEndian.PutUint64(n[:], uint64(len(part)))
		h.Write(n[:])
		h.Write([]byte(part))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// consensusCacheKey returns the storage key for a validated request.
func consensusCacheKey(req *ConsensusRequest) consensusKey {
	chainID := req.ChainID
	if chainID == "" {
		chainID = "unknown"
	}
	return consensusKey{
		RealmPath:    req.RealmPath,
		AnalysisType: req.AnalysisType,
		ProposalID:   req.ProposalID,
		ChainID:      chainID,
		InputDigest:  consensusInputDigest(req),
	}
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

func getCachedConsensus(db *sql.DB, key consensusKey) (*ConsensusResponse, error) {
	var consensusJSON string
	var expiresAt time.Time

	err := db.QueryRow(
		`SELECT consensus, expires_at FROM analyst_reports
		 WHERE realm_path = ? AND analysis_type = ? AND proposal_id = ? AND chain_id = ? AND input_digest = ? AND expires_at > ?`,
		key.RealmPath, key.AnalysisType, key.ProposalID, key.ChainID, key.InputDigest, time.Now().UTC(),
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
	resp.InputDigest = key.InputDigest
	return &resp, nil
}

func cacheConsensus(db *sql.DB, key consensusKey, resp *ConsensusResponse) {
	ttl := getDefaultCacheTTL()
	expiresAt := time.Now().UTC().Add(ttl)

	respJSON, err := json.Marshal(resp)
	if err != nil {
		slog.Warn("failed to marshal consensus for cache", "error", err)
		return
	}

	_, err = db.Exec(
		`INSERT OR REPLACE INTO analyst_reports (realm_path, analysis_type, proposal_id, chain_id, input_digest, consensus, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		key.RealmPath, key.AnalysisType, key.ProposalID, key.ChainID, key.InputDigest, string(respJSON), expiresAt,
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
	total := len(perspectives)

	// Only models that actually returned an analysis inform the verdict — a failed
	// free-model (Responded=false) must not dilute agreement or drag down confidence.
	responded := make([]ConsensusPerspective, 0, total)
	for _, p := range perspectives {
		if p.Responded {
			responded = append(responded, p)
		}
	}

	if len(responded) == 0 {
		return ConsensusVerdict{
			Verdict:        "abstain",
			Confidence:     0,
			AgreementLevel: "contested",
			RespondedCount: 0,
			TotalCount:     total,
			Summary:        "No models returned an analysis.",
		}
	}

	// Weighted verdict scoring (responders only)
	scores := map[string]float64{"approve": 0, "reject": 0, "caution": 0, "abstain": 0}
	for _, p := range responded {
		w := perspectiveWeights[p.Role]
		if w == 0 {
			w = 1.0
		}
		scores[p.Verdict] += w * p.Confidence
	}

	// Find winning verdict (fixed order → deterministic tie-breaks)
	verdict := "abstain"
	maxScore := -1.0
	for _, v := range []string{"approve", "reject", "caution", "abstain"} {
		if scores[v] > maxScore {
			maxScore = scores[v]
			verdict = v
		}
	}

	// Agreement + weighted confidence (responders only)
	agreeCount := 0
	weightedSum := 0.0
	weightTotal := 0.0
	for _, p := range responded {
		w := perspectiveWeights[p.Role]
		if w == 0 {
			w = 1.0
		}
		if p.Verdict == verdict {
			agreeCount++
		}
		weightedSum += p.Confidence * w
		weightTotal += w
	}
	confidence := 0.0
	if weightTotal > 0 {
		confidence = weightedSum / weightTotal
	}
	confidence = math.Round(confidence*100) / 100

	// Agreement level
	ratio := float64(agreeCount) / float64(len(responded))
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

	for _, p := range responded {
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

	summary := fmt.Sprintf("%s (confidence: %d%%). %s %d of %d responding models agree (%d of %d models responded).",
		verdictText[verdict], int(confidence*100), agreementText[agreementLevel],
		agreeCount, len(responded), len(responded), total)

	return ConsensusVerdict{
		Verdict:            verdict,
		Confidence:         confidence,
		AgreementLevel:     agreementLevel,
		AgreeCount:         agreeCount,
		RespondedCount:     len(responded),
		TotalCount:         total,
		Summary:            summary,
		KeyRisks:           risks,
		KeyRecommendations: recs,
	}
}

// ── Handler ──────────────────────────────────────────────────

// HandleAnalystConsensus handles POST /api/analyst/consensus.
// Fans out to 10 OpenRouter models (2 batches of 5), aggregates, caches.
//
// The route must be wrapped in AnalystGate and must set the caller identity:
// a wallet address (WithAuthAddress) or the analyst admin (WithAnalystAdmin).
// Without one the handler answers 401. Only the admin may force a refresh or
// generate without the per-wallet daily quota.
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

		isAdmin := AnalystAdminFrom(r.Context())
		wallet, hasWallet := AuthAddressFrom(r.Context())
		if !isAdmin && !hasWallet {
			http.Error(w, `{"error":"authorization required"}`, http.StatusUnauthorized)
			return
		}

		// Only the admin may skip the cache; a wallet's force request is
		// served like a normal one.
		cacheKey := consensusCacheKey(&req)
		forceRefresh := isAdmin && r.URL.Query().Get("force") == "1"
		if !forceRefresh {
			if cached, err := getCachedConsensus(db, cacheKey); err == nil && cached != nil {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(cached)
				return
			}
		}

		// Bound the total handler execution to 55s (fits within 90s WriteTimeout).
		ctx, cancel := context.WithTimeout(r.Context(), 55*time.Second)
		defer cancel()

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

		if !isAdmin {
			allowed, err := reserveAnalystQuota(ctx, db, wallet, time.Now())
			if err != nil {
				slog.Warn("analyst quota check failed", "error", err)
				http.Error(w, `{"error":"analysis unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			if !allowed {
				http.Error(w, `{"error":"daily analysis limit reached"}`, http.StatusTooManyRequests)
				return
			}
		}

		start := time.Now()
		perspectives := make([]ConsensusPerspective, len(orProviders))

		userPrompt := buildConsensusUserPrompt(&req)

		// Select system prompt based on analysis type
		getSystemPrompt := perspectiveSystemPrompt
		if req.AnalysisType == "dao" {
			getSystemPrompt = daoHealthSystemPrompt
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

					systemPrompt := getSystemPrompt(provider.Role)
					llmOutput, err := callLLM(ctx, provider, systemPrompt, userPrompt)

					if err != nil {
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
							Reasoning:   "Model unavailable",
							Risks:       []string{"Analysis unavailable"},
						}
						return
					}
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
						Responded:       true,
					}
				}(i, orProviders[i])
			}
			wg.Wait()

			// Gap between batches (only if more batches remain)
			if batchEnd < len(orProviders) {
				select {
				case <-ctx.Done():
					http.Error(w, `{"error":"request cancelled"}`, http.StatusRequestTimeout)
					return
				case <-time.After(1 * time.Second):
				}
			}
		}

		consensus := aggregateConsensus(perspectives)
		resp := ConsensusResponse{
			Consensus:    consensus,
			Perspectives: perspectives,
			ProcessingMs: time.Since(start).Milliseconds(),
			Cached:       false,
			InputDigest:  cacheKey.InputDigest,
		}

		// Only cache if at least one model returned a real verdict (not all-abstain)
		hasRealResult := false
		for _, p := range perspectives {
			if p.Verdict != "abstain" {
				hasRealResult = true
				break
			}
		}
		if hasRealResult {
			cacheConsensus(db, cacheKey, &resp)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("failed to write consensus response", "error", err)
		}
	})
}

// ── Chain Context ────────────────────────────────────────────

// buildChainContext returns structured metadata about the chain network.
// This gives AI models critical context about the governance environment.
// It accepts a network key (e.g. "mainnet") or a chain ID (e.g. "gnoland-1").
func buildChainContext(chainID string) string {
	type chainInfo struct {
		name     string
		maturity string
		note     string
	}

	networks := map[string]chainInfo{
		"gnoland-1": {
			name:     "gno.land Mainnet (gnoland-1)",
			maturity: "MAINNET — production chain, tokens carry real value, governance decisions are binding",
			note:     "Governance outcomes here have real and lasting impact on members and funds.",
		},
		"pearl-1": {
			name:     "gno.land Pearl Testnet",
			maturity: "TESTNET — experimental, frequent resets, test tokens with no real value",
			note:     "Governance decisions here are for testing and community coordination, not financial value.",
		},
		"sapphire-1": {
			name:     "gno.land Sapphire Testnet (retired 2026-09-09)",
			maturity: "TESTNET — experimental, frequent resets, test tokens with no real value",
			note:     "Governance decisions here are for testing and community coordination, not financial value.",
		},
		"topaz-1": {
			name:     "gno.land Topaz Testnet (retired 2026-08-12)",
			maturity: "TESTNET — experimental, frequent resets, test tokens with no real value",
			note:     "Governance decisions here are for testing and community coordination, not financial value.",
		},
		"test-13": {
			name:     "gno.land Testnet 13 (retired 2026-07-26)",
			maturity: "TESTNET — experimental, frequent resets, test tokens with no real value",
			note:     "Governance decisions here are for testing and community coordination, not financial value.",
		},
		"gnoland1": {
			name:     "gno.land Betanet (gnoland1)",
			maturity: "BETANET — pre-production, tokens have emerging value, governance decisions carry weight",
			note:     "This chain may experience consensus bugs. Governance impact is real but limited.",
		},
		"portal-loop": {
			name:     "gno.land Portal Loop",
			maturity: "DEVELOPMENT — rolling testnet, auto-reset, used for rapid iteration",
			note:     "Governance here is purely experimental. No persistence guarantees.",
		},
		"staging": {
			name:     "gno.land Staging",
			maturity: "STAGING — internal testing environment",
			note:     "Not public-facing. Governance is for internal validation only.",
		},
	}

	if canonical, known := resolveAnalystChainID(chainID); known {
		chainID = canonical
	}
	info, ok := networks[chainID]
	if !ok {
		if chainID == "" {
			return "Network: Unknown\nMaturity: Chain ID not provided — treat governance analysis with appropriate caution."
		}
		return fmt.Sprintf("Network: %s\nMaturity: Unknown network — treat governance analysis with appropriate caution.", chainID)
	}

	return fmt.Sprintf(
		"Network: %s\nChain ID: %s\nMaturity: %s\nNote: %s",
		info.name, chainID, info.maturity, info.note,
	)
}

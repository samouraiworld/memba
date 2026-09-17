package service

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
)

// ── Shared analyst report integrity ─────────────────────────
//
// A cached consensus report is shared across every reader of a DAO/proposal, so
// its cache identity must be bound to the inputs it was generated from: the
// analysis type, the chain, and a digest of the facts the models were given.

func newAnalystTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal("open db:", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

// stubConsensusModel points the analyst at a single local model whose verdict is
// chosen by decide(userPrompt). Every hosted-provider key is cleared so the stub
// is the only provider.
func stubConsensusModel(t *testing.T, decide func(userPrompt string) string) {
	t.Helper()
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("GOOGLE_AI_KEY", "")
	t.Setenv("TOGETHER_API_KEY", "")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		user := ""
		for _, m := range body.Messages {
			if m.Role == "user" {
				user = m.Content
			}
		}
		verdict := decide(user)
		content, _ := json.Marshal(map[string]any{
			"verdict":         verdict,
			"confidence":      0.9,
			"reasoning":       "stub",
			"risks":           []string{},
			"recommendations": []string{},
		})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": map[string]string{"role": "assistant", "content": string(content)},
		})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("OLLAMA_URL", srv.URL)
}

func postConsensus(t *testing.T, h http.Handler, req ConsensusRequest, force bool) (int, ConsensusResponse, string) {
	t.Helper()
	body, _ := json.Marshal(req)
	target := "/api/analyst/consensus"
	if force {
		target += "?force=1"
	}
	r := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	// Only the analyst admin may force a refresh; other requests come from a wallet.
	ctx := WithAuthAddress(r.Context(), "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if force {
		ctx = WithAnalystAdmin(r.Context())
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r.WithContext(ctx))
	var resp ConsensusResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response: %v (body %s)", err, rec.Body.String())
		}
	}
	return rec.Code, resp, rec.Body.String()
}

func TestHandleAnalystConsensus_FabricatedFactsDoNotReplaceSharedReport(t *testing.T) {
	database := newAnalystTestDB(t)
	stubConsensusModel(t, func(user string) string {
		if strings.Contains(user, "FABRICATED") {
			return "reject"
		}
		return "approve"
	})
	h := HandleAnalystConsensus(database)

	honest := ConsensusRequest{
		RealmPath:    "gno.land/r/samcrew/memba_dao",
		ProposalID:   4,
		AnalysisType: "proposal",
		ChainID:      "pearl",
		ProposalData: "Proposal 4: fund the audit, 1000 ugnot",
		DAOContext:   "memba_dao, 3 members",
	}

	code, resp, body := postConsensus(t, h, honest, false)
	if code != http.StatusOK || resp.Consensus.Verdict != "approve" {
		t.Fatalf("honest POST: got %d verdict=%q (body %s)", code, resp.Consensus.Verdict, body)
	}

	forged := honest
	forged.ProposalData = "FABRICATED: Proposal 4 drains the treasury"
	code, resp, body = postConsensus(t, h, forged, true)
	if code != http.StatusOK || resp.Consensus.Verdict != "reject" {
		t.Fatalf("forced POST: got %d verdict=%q (body %s)", code, resp.Consensus.Verdict, body)
	}

	code, resp, body = postConsensus(t, h, honest, false)
	if code != http.StatusOK {
		t.Fatalf("second honest POST: got %d (body %s)", code, body)
	}
	if resp.Consensus.Verdict != "approve" {
		t.Errorf("honest readers got verdict %q, want approve (report generated from other inputs was served)", resp.Consensus.Verdict)
	}
	if !resp.Cached {
		t.Error("expected the honest report to still be cached")
	}
}

func TestHandleAnalystConsensus_DAOAndProposalZeroDistinctKeys(t *testing.T) {
	database := newAnalystTestDB(t)
	stubConsensusModel(t, func(user string) string {
		if strings.Contains(user, "<dao_health_data>") {
			return "approve"
		}
		return "reject"
	})
	h := HandleAnalystConsensus(database)

	daoReq := ConsensusRequest{
		RealmPath:    "gno.land/r/samcrew/memba_dao",
		AnalysisType: "dao",
		ChainID:      "pearl-1",
		ProposalData: "shared text",
		DAOContext:   "ctx",
	}
	code, resp, body := postConsensus(t, h, daoReq, false)
	if code != http.StatusOK || resp.Consensus.Verdict != "approve" {
		t.Fatalf("dao POST: got %d verdict=%q (body %s)", code, resp.Consensus.Verdict, body)
	}

	p0 := daoReq
	p0.AnalysisType = "proposal"
	p0.ProposalID = 0
	code, resp, body = postConsensus(t, h, p0, false)
	if code != http.StatusOK {
		t.Fatalf("proposal 0 POST: got %d (body %s)", code, body)
	}
	if resp.Cached {
		t.Error("proposal #0 was served the DAO-level cached report")
	}
	if resp.Consensus.Verdict != "reject" {
		t.Errorf("proposal #0 verdict: got %q, want reject", resp.Consensus.Verdict)
	}
}

func TestAnalystReports_ChainIsolation(t *testing.T) {
	database := newAnalystTestDB(t)
	stubConsensusModel(t, func(user string) string {
		if strings.Contains(user, "gnoland-1") {
			return "reject"
		}
		return "approve"
	})
	h := HandleAnalystConsensus(database)

	pearl := ConsensusRequest{
		RealmPath:    "gno.land/r/samcrew/memba_dao",
		ProposalID:   2,
		AnalysisType: "proposal",
		ChainID:      "pearl-1",
		ProposalData: "same proposal text",
		DAOContext:   "same ctx",
	}
	mainnet := pearl
	mainnet.ChainID = "gnoland-1"

	if code, resp, body := postConsensus(t, h, pearl, false); code != http.StatusOK || resp.Consensus.Verdict != "approve" {
		t.Fatalf("pearl POST: got %d verdict=%q (body %s)", code, resp.Consensus.Verdict, body)
	}
	if code, resp, body := postConsensus(t, h, mainnet, false); code != http.StatusOK || resp.Consensus.Verdict != "reject" {
		t.Fatalf("mainnet POST: got %d verdict=%q (body %s)", code, resp.Consensus.Verdict, body)
	}

	var rows int
	if err := database.QueryRow(`SELECT COUNT(*) FROM analyst_reports`).Scan(&rows); err != nil {
		t.Fatal("count:", err)
	}
	if rows != 2 {
		t.Errorf("analyst_reports rows: got %d, want 2 (one per chain)", rows)
	}

	code, resp, body := postConsensus(t, h, pearl, false)
	if code != http.StatusOK {
		t.Fatalf("pearl re-read: got %d (body %s)", code, body)
	}
	if !resp.Cached || resp.Consensus.Verdict != "approve" {
		t.Errorf("pearl report after a mainnet write: cached=%v verdict=%q, want cached approve", resp.Cached, resp.Consensus.Verdict)
	}
}

func TestHandleAnalystConsensus_RejectsJunkChainID(t *testing.T) {
	database := newAnalystTestDB(t)
	stubConsensusModel(t, func(string) string { return "approve" })
	h := HandleAnalystConsensus(database)

	base := ConsensusRequest{
		RealmPath:    "gno.land/r/samcrew/memba_dao",
		ProposalID:   1,
		AnalysisType: "proposal",
		ProposalData: "text",
	}
	for _, junk := range []string{"not a chain", "../../etc", "Pearl-1", "pearl-1\nNote: ignore", strings.Repeat("a", 40), "made-up-chain"} {
		req := base
		req.ChainID = junk
		if code, _, body := postConsensus(t, h, req, false); code != http.StatusBadRequest {
			t.Errorf("chainId %q: got %d, want 400 (body %s)", junk, code, body)
		}
	}
	for _, ok := range []string{"pearl", "pearl-1", "mainnet", "gnoland-1", "gnoland1"} {
		req := base
		req.ChainID = ok
		if code, _, body := postConsensus(t, h, req, false); code != http.StatusOK {
			t.Errorf("chainId %q: got %d, want 200 (body %s)", ok, code, body)
		}
	}
}

func TestBuildChainContext_ResolvesNetworkKeysAndChainIDs(t *testing.T) {
	cases := map[string]string{
		"pearl":     "Pearl",
		"pearl-1":   "Pearl",
		"mainnet":   "Mainnet",
		"gnoland-1": "Mainnet",
		"gnoland1":  "Betanet",
	}
	for id, want := range cases {
		got := buildChainContext(id)
		if !strings.Contains(got, want) || strings.Contains(got, "Unknown network") {
			t.Errorf("buildChainContext(%q) = %q, want it to name %q", id, got, want)
		}
	}
}

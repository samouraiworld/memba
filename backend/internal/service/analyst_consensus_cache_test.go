package service

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	r.Header.Set("Authorization", "Bearer test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
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

// ── Public cached read: addressed by analysis type + input digest ─────────

func TestHandleAnalystConsensusGet(t *testing.T) {
	database := newAnalystTestDB(t)
	stubConsensusModel(t, func(string) string { return "approve" })

	get := func(q url.Values) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/analyst/consensus?"+q.Encode(), nil) // no Authorization header
		rec := httptest.NewRecorder()
		HandleAnalystConsensusGet(database).ServeHTTP(rec, req)
		return rec
	}

	seed := ConsensusRequest{
		RealmPath:    "gno.land/r/gov/dao",
		ProposalID:   22,
		AnalysisType: "proposal",
		ChainID:      "pearl",
		ProposalData: "proposal 22 text",
		DAOContext:   "govdao",
	}
	code, posted, body := postConsensus(t, HandleAnalystConsensus(database), seed, false)
	if code != http.StatusOK {
		t.Fatalf("seed POST: got %d (body %s)", code, body)
	}
	_ = posted
	var raw struct {
		InputDigest string `json:"inputDigest"`
	}
	_ = json.Unmarshal([]byte(body), &raw)
	if len(raw.InputDigest) != 64 {
		t.Fatalf("POST response inputDigest: got %q, want a 64-char hex digest", raw.InputDigest)
	}

	addr := func() url.Values {
		return url.Values{
			"realm":        {"gno.land/r/gov/dao"},
			"proposalId":   {"22"},
			"analysisType": {"proposal"},
			"chainId":      {"pearl"},
			"inputDigest":  {raw.InputDigest},
		}
	}

	t.Run("returns the report addressed by its input digest without auth", func(t *testing.T) {
		rec := get(addr())
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d (body %s)", rec.Code, rec.Body.String())
		}
		var got ConsensusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.Consensus.Verdict != "approve" || !got.Cached {
			t.Errorf("got verdict=%q cached=%v, want cached approve", got.Consensus.Verdict, got.Cached)
		}
	})

	t.Run("400 without an input digest", func(t *testing.T) {
		q := addr()
		q.Del("inputDigest")
		if rec := get(q); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("400 on a malformed input digest", func(t *testing.T) {
		q := addr()
		q.Set("inputDigest", "zz")
		if rec := get(q); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("400 without an analysis type", func(t *testing.T) {
		q := addr()
		q.Del("analysisType")
		if rec := get(q); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("204 for a digest with no report", func(t *testing.T) {
		q := addr()
		q.Set("inputDigest", strings.Repeat("0", 64))
		if rec := get(q); rec.Code != http.StatusNoContent {
			t.Errorf("expected 204, got %d", rec.Code)
		}
	})

	t.Run("204 for the same digest under another analysis type", func(t *testing.T) {
		q := addr()
		q.Set("analysisType", "dao")
		if rec := get(q); rec.Code != http.StatusNoContent {
			t.Errorf("expected 204, got %d", rec.Code)
		}
	})

	t.Run("400 on invalid realm path", func(t *testing.T) {
		q := addr()
		q.Set("realm", "evil/path")
		if rec := get(q); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("400 on junk chainId", func(t *testing.T) {
		q := addr()
		q.Set("chainId", "not a chain")
		if rec := get(q); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("405 on non-GET", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/analyst/consensus", nil)
		rec := httptest.NewRecorder()
		HandleAnalystConsensusGet(database).ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected 405, got %d", rec.Code)
		}
	})
}

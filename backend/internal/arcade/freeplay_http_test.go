package arcade

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type freeAuthFake struct{ player, chain string }

func (a freeAuthFake) ValidateRESTTokenIdentity(string) (string, string, error) {
	return a.player, a.chain, nil
}

type freeLimitFake bool

func (l freeLimitFake) AllowFreePlay(context.Context, string, string) bool { return bool(l) }
func callFree(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, FreePlayPrefix+path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestFreePlayHTTPVerifyAndNoPublicationPolicy(t *testing.T) {
	s := freeStore(t)
	vectors, _ := freeVectors(t)
	v := vectors[0]
	raw, _ := json.Marshal(v.Input)
	cfg := FreePlayHTTPConfig{Enabled: true, Target: v.Target, Store: s, Auth: freeAuthFake{v.Player, v.Target.ChainID}, Limiter: freeLimitFake(true)}
	h := NewFreePlayHandler(cfg)
	w := callFree(h, "POST", "verify", string(raw))
	if w.Code != 200 {
		t.Fatalf("verify %d %s", w.Code, w.Body.String())
	}
	var run FreePlayRun
	if err := json.Unmarshal(w.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	if run.Status != "verified" || run.Receipt != nil {
		t.Fatal("verification became confirmation")
	}
	for _, suffix := range []string{"quote", "publish"} {
		w = callFree(h, "POST", "runs/"+run.Entry.RunID+"/"+suffix, "{}")
		if w.Code != 503 {
			t.Fatalf("ungated %s: %d", suffix, w.Code)
		}
	}
	cfg.Auth = freeAuthFake{v.Player, "onyx-1"}
	if w = callFree(NewFreePlayHandler(cfg), "POST", "verify", string(raw)); w.Code != 403 {
		t.Fatalf("network %d", w.Code)
	}
	cfg.Auth = freeAuthFake{v.Player, ""}
	if w = callFree(NewFreePlayHandler(cfg), "POST", "verify", string(raw)); w.Code != 403 {
		t.Fatal("chainless accepted")
	}
	cfg.Auth = freeAuthFake{v.Player, v.Target.ChainID}
	cfg.Limiter = nil
	if w = callFree(NewFreePlayHandler(cfg), "POST", "verify", string(raw)); w.Code != 404 {
		t.Fatal("limiter optional")
	}
}
func TestFreePlayHTTPStrictBodyAndDormant(t *testing.T) {
	v, _ := freeVectors(t)
	s := freeStore(t)
	cfg := FreePlayHTTPConfig{Enabled: true, Target: v[0].Target, Store: s, Auth: freeAuthFake{v[0].Player, v[0].Target.ChainID}, Limiter: freeLimitFake(true)}
	for _, body := range []string{`{"game":"block-party","player":"spoof"}`, `{} {}`, strings.Repeat("x", int(FreePlayMaxBody)+1)} {
		w := callFree(NewFreePlayHandler(cfg), "POST", "verify", body)
		if w.Code != 400 {
			t.Fatalf("body: %d", w.Code)
		}
	}
	cfg.Enabled = false
	if w := callFree(NewFreePlayHandler(cfg), "POST", "verify", "{}"); w.Code != 404 {
		t.Fatal("default gate bypass")
	}
}

type freeBoardFake struct {
	entries []FreePlayReceipt
	err     error
}

func (f freeBoardFake) ReadBoard(context.Context, FreePlayTarget, string, string, int64, int, int) ([]FreePlayReceipt, error) {
	return f.entries, f.err
}
func TestFreePlayBoardReadsOnlyConfirmedGameAndRules(t *testing.T) {
	s := freeStore(t)
	run := freeFixture(t)
	cfg := FreePlayHTTPConfig{Enabled: true, Target: run.Target, Store: s, Auth: freeAuthFake{}, Limiter: freeLimitFake(true)}
	path := "boards/block-party?rules=" + run.Entry.Rules + "&simVersion=1"
	// Public lookup must not call auth or substitute the verified local score.
	request := func(cfg FreePlayHTTPConfig) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", FreePlayPrefix+path, nil)
		w := httptest.NewRecorder()
		NewFreePlayHandler(cfg).ServeHTTP(w, r)
		return w
	}
	if w := request(cfg); w.Code != 503 {
		t.Fatalf("missing realm reader: %d", w.Code)
	}
	receipt := FreePlayReceipt{Target: run.Target, Entry: run.Entry, Height: 42, Attester: run.Entry.Player, SchemaVersion: 2}
	cfg.Boards = freeBoardFake{entries: []FreePlayReceipt{receipt}}
	if w := request(cfg); w.Code != 200 {
		t.Fatalf("confirmed board: %d %s", w.Code, w.Body.String())
	}
	receipt.Entry.Game = "barricade"
	cfg.Boards = freeBoardFake{entries: []FreePlayReceipt{receipt}}
	if w := request(cfg); w.Code != 503 {
		t.Fatal("cross-game entry accepted")
	}
	path = "boards/all?rules=" + run.Entry.Rules + "&simVersion=1"
	if w := request(cfg); w.Code != 400 {
		t.Fatal("global leaderboard accepted")
	}
}

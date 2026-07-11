package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeProofsFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "allowlist_proofs.json")
	fixture := `{"root":"ab12","count":1,"entries":{"g1buyerfulladdress":{"maxQty":2,"proof":"aa,bb"}}}`
	if err := os.WriteFile(p, []byte(fixture), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAllowlistProof_Found(t *testing.T) {
	h := HandleAllowlistProof(writeProofsFixture(t))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/nft/allowlist-proof?address=g1buyerfulladdress", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got struct {
		Root   string `json:"root"`
		MaxQty int64  `json:"maxQty"`
		Proof  string `json:"proof"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Root != "ab12" || got.MaxQty != 2 || got.Proof != "aa,bb" {
		t.Fatalf("bad body: %+v", got)
	}
}

func TestAllowlistProof_NotFoundAndDisabled(t *testing.T) {
	h := HandleAllowlistProof(writeProofsFixture(t))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/nft/allowlist-proof?address=g1notonlist", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("unknown addr: status = %d, want 404", rr.Code)
	}
	off := HandleAllowlistProof("") // env unset => disabled
	rr2 := httptest.NewRecorder()
	off.ServeHTTP(rr2, httptest.NewRequest(http.MethodGet, "/api/nft/allowlist-proof?address=g1buyerfulladdress", nil))
	if rr2.Code != http.StatusNotFound {
		t.Fatalf("disabled: status = %d, want 404", rr2.Code)
	}
}

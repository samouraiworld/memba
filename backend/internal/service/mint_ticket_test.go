package service

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "modernc.org/sqlite"
)

func ticketTestDB(t *testing.T, minted int) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE nft_tokens (collection_id TEXT, token_id TEXT)`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < minted; i++ {
		if _, err := db.Exec(`INSERT INTO nft_tokens VALUES ('g1creator/membas', ?)`, i); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func getTicket(t *testing.T, h http.Handler) (code int, tid, edition int64, uri string) {
	t.Helper()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/nft/mint-ticket", nil))
	if rr.Code != http.StatusOK {
		return rr.Code, 0, 0, ""
	}
	var got struct {
		Tid      int64  `json:"tid"`
		Edition  int64  `json:"edition"`
		TokenURI string `json:"tokenURI"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return rr.Code, got.Tid, got.Edition, got.TokenURI
}

func TestMintTicket_SequentialSuggestions(t *testing.T) {
	db := ticketTestDB(t, 3) // tids 0,1,2 minted -> next is 3
	h := HandleMintTicket(db, TicketConfig{
		CollectionID: "g1creator/membas", URIBase: "ipfs://CID/", Prefix: "Memba", ReserveSeconds: 90,
	})
	code, tid, edition, uri := getTicket(t, h)
	if code != 200 || tid != 3 || edition != 4 || uri != "ipfs://CID/Memba_0004.json" {
		t.Fatalf("first ticket = %d %d %d %q", code, tid, edition, uri)
	}
	// A second concurrent buyer must be offered the NEXT slot while 3 is reserved.
	_, tid2, _, _ := getTicket(t, h)
	if tid2 != 4 {
		t.Fatalf("second ticket tid = %d, want 4 (3 reserved)", tid2)
	}
}

func TestMintTicket_DisabledWithoutConfig(t *testing.T) {
	h := HandleMintTicket(nil, TicketConfig{})
	code, _, _, _ := getTicket(t, h)
	if code != http.StatusNotFound {
		t.Fatalf("disabled: status = %d, want 404", code)
	}
}

package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func mkTx(block int64, fn string, args ...string) creationTx {
	tx := creationTx{BlockHeight: block}
	tx.Messages = append(tx.Messages, struct {
		Value struct {
			Typename string   `json:"__typename"`
			Func     string   `json:"func"`
			Args     []string `json:"args"`
		} `json:"value"`
	}{})
	tx.Messages[0].Value.Typename = "MsgCall"
	tx.Messages[0].Value.Func = fn
	tx.Messages[0].Value.Args = args
	return tx
}

func TestExtractCreationBlocks(t *testing.T) {
	t.Run("maps symbol (args[1]) to its block — real CANICULE shape", func(t *testing.T) {
		got := extractCreationBlocks([]creationTx{
			mkTx(428216, "New", "CANICULE", "HOT", "6", "100000000", "100"),
		})
		if got["HOT"] != 428216 {
			t.Fatalf("HOT: want 428216, got %d", got["HOT"])
		}
	})

	t.Run("handles NewWithAdmin and keeps the EARLIEST block per symbol", func(t *testing.T) {
		got := extractCreationBlocks([]creationTx{
			mkTx(500, "New", "Foo Token", "FOO"),
			mkTx(200, "NewWithAdmin", "Foo Token", "FOO", "6", "0", "0", "g1admin"), // earlier = original
		})
		if got["FOO"] != 200 {
			t.Fatalf("FOO: want earliest 200, got %d", got["FOO"])
		}
	})

	t.Run("skips non-creation funcs, wrong typenames, and short args", func(t *testing.T) {
		got := extractCreationBlocks([]creationTx{
			mkTx(10, "Mint", "X", "BAR"), // not a creation func
			mkTx(11, "New", "OnlyName"),  // args < 2 → no symbol
			mkTx(12, "New", "Name", ""),  // empty symbol
			func() creationTx {
				tx := mkTx(13, "New", "Name", "OK")
				tx.Messages[0].Value.Typename = "BankMsgSend"
				return tx
			}(),
		})
		if len(got) != 0 {
			t.Fatalf("want no entries, got %v", got)
		}
	})
}

func TestHandleTokenLaunches(t *testing.T) {
	t.Run("GET returns a JSON object (empty before the background scan resolves)", func(t *testing.T) {
		srv := httptest.NewServer(HandleTokenLaunches())
		defer srv.Close()
		resp, err := http.Get(srv.URL)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status: want 200, got %d", resp.StatusCode)
		}
		var m map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
			t.Fatalf("body must be a JSON object: %v", err)
		}
	})

	t.Run("rejects non-GET", func(t *testing.T) {
		srv := httptest.NewServer(HandleTokenLaunches())
		defer srv.Close()
		resp, err := http.Post(srv.URL, "application/json", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("status: want 405, got %d", resp.StatusCode)
		}
	})
}

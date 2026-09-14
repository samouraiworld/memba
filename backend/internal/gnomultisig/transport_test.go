package gnomultisig

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rpcserver "github.com/gnolang/gno/tm2/pkg/bft/rpc/lib/server"
	rpctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/lib/types"
	bft "github.com/gnolang/gno/tm2/pkg/bft/types"
	"github.com/gnolang/gno/tm2/pkg/log"
)

// Exercise the real native RPC dispatcher without listening on a socket.
// Method-named HTTP routes do not decode JSON-RPC bodies; only the root does.
func TestNativeJSONRPCTransport(t *testing.T) {
	want := []byte{8, 2, 18, 1, 0}
	body := fmt.Sprintf(`{"jsonrpc":"2.0","method":"broadcast_tx_commit","params":{"tx":%q},"id":1}`, base64.StdEncoding.EncodeToString(want))
	for _, path := range []string{"/", "/broadcast_tx_commit"} {
		t.Run(path, func(t *testing.T) {
			var received []byte
			mux := http.NewServeMux()
			rpcserver.RegisterRPCFuncs(mux, map[string]*rpcserver.RPCFunc{
				"broadcast_tx_commit": rpcserver.NewRPCFunc(func(_ *rpctypes.Context, tx bft.Tx) (string, error) {
					received = append([]byte(nil), tx...)
					return "fixture", nil
				}, "tx"),
			}, log.NewNoopLogger())
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if path == "/" {
				if rec.Code != http.StatusOK || !bytes.Equal(received, want) {
					t.Fatalf("native root did not decode bytes: %x; %s", received, rec.Body.String())
				}
			} else if bytes.Equal(received, want) {
				t.Fatal("method route unexpectedly decoded a JSON-RPC body; recheck transport contract")
			}
		})
	}
}

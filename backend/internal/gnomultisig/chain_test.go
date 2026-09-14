package gnomultisig

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gnolang/gno/gno.land/pkg/gnoland"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	bft "github.com/gnolang/gno/tm2/pkg/bft/types"
	"github.com/gnolang/gno/tm2/pkg/db/memdb"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// Exercise the pinned chain application, including first master-key binding,
// CheckTx/DeliverTx and replay protection. Entirely in-memory: no sockets,
// external RPC, real keybase, on-chain funding or package deployment.
func TestNativeAggregateIsolatedChain(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		pk, keys, f := signingFixture(t)
		f.FeeJSON = `{"gas_wanted":"10000000","gas_fee":"1000000ugnot"}`
		app, err := gnoland.NewAppWithOptions(gnoland.TestAppOptions(memdb.NewMemDB()))
		if err != nil {
			t.Fatal(err)
		}
		gen := gnoland.DefaultGenState()
		gen.Balances = []gnoland.Balance{{Address: pk.Address(), Amount: std.Coins{{Denom: "ugnot", Amount: 10000000000}}}}
		init := app.InitChain(abci.RequestInitChain{AppState: gen, ChainID: f.ChainID, Time: time.Unix(1700000000, 0), ConsensusParams: &abci.ConsensusParams{Block: &abci.BlockParams{MaxGas: 100000000}}})
		if !init.IsOK() {
			t.Fatalf("InitChain: %v", init.Error)
		}
		app.Commit()
		_, b, err := Assemble(pk, f, []Partial{signPartial(t, pk, keys[2], f, legacy), signPartial(t, pk, keys[0], f, legacy)})
		if err != nil {
			t.Fatal(err)
		}
		if res := app.CheckTx(abci.RequestCheckTx{Tx: b}); !res.IsOK() {
			t.Fatalf("CheckTx legacy=%v: %v", legacy, res.Error)
		}
		app.BeginBlock(abci.RequestBeginBlock{Header: &bft.Header{ChainID: f.ChainID, Height: 1, Time: time.Unix(1700000001, 0)}})
		if res := app.DeliverTx(abci.RequestDeliverTx{Tx: b}); !res.IsOK() {
			t.Fatalf("DeliverTx legacy=%v: %+v", legacy, res)
		} else {
			t.Logf("native delivery legacy=%v gas wanted=%d used=%d", legacy, res.GasWanted, res.GasUsed)
		}
		if res := app.DeliverTx(abci.RequestDeliverTx{Tx: b}); res.IsOK() {
			t.Fatal("replayed transaction accepted")
		}
		app.EndBlock(abci.RequestEndBlock{Height: 1})
		app.Commit()
		query := app.Query(abci.RequestQuery{Path: "auth/accounts/" + pk.Address().String()})
		if !query.IsOK() {
			t.Fatal(query.Error)
		}
		var state struct {
			BaseAccount struct {
				Sequence string `json:"sequence"`
			}
		}
		if err := json.Unmarshal(query.Data, &state); err != nil || state.BaseAccount.Sequence != "1" {
			t.Fatalf("native account data: %s (%v)", query.Data, err)
		}
		// The next proposal must use the nonzero sequence read from account Data.
		f.Sequence = 1
		_, next, err := Assemble(pk, f, []Partial{signPartial(t, pk, keys[2], f, legacy), signPartial(t, pk, keys[0], f, legacy)})
		if err != nil {
			t.Fatal(err)
		}
		if res := app.CheckTx(abci.RequestCheckTx{Tx: next}); !res.IsOK() {
			t.Fatal(res.Error)
		}
		app.BeginBlock(abci.RequestBeginBlock{Header: &bft.Header{ChainID: f.ChainID, Height: 2, Time: time.Unix(1700000002, 0)}})
		if res := app.DeliverTx(abci.RequestDeliverTx{Tx: next}); !res.IsOK() {
			t.Fatal(res.Error)
		}
	}
}

package launchpadwatch

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
)

const configRealm = "gno.land/r/samcrew/launchpad/config/v1"

// SalesPath is the realm whose fees the keeper sweeps.
const SalesPath = salesRealm

// SweepPlan is what a sweep is expected to pay: the stable fees, to the
// treasury of the current config.
type SweepPlan struct {
	Fees     *big.Int
	Treasury string
	Height   int64
}

// PlanSweep reads the sales fees at a stable reading and the current treasury,
// both from rpcURL after checking that it serves chainID.
func PlanSweep(ctx context.Context, rpcURL, chainID string) (SweepPlan, error) {
	w := &Watcher{cfg: Config{RPCURL: rpcURL, ChainID: chainID}, node: newNode(rpcURL), attempts: 5, retryDelay: 3 * time.Second, pause: sleep}
	r, err := w.readSales(ctx)
	if err != nil {
		return SweepPlan{}, err
	}
	if r.problem != "" {
		return SweepPlan{}, fmt.Errorf("sales books: %s", r.problem)
	}
	if _, err := w.node.checkChain(ctx, chainID); err != nil {
		return SweepPlan{}, err
	}
	treasury, err := w.node.qevalAddress(ctx, configRealm+".GetTreasury()")
	if err != nil {
		return SweepPlan{}, err
	}
	return SweepPlan{Fees: r.liabilities["fees"], Treasury: treasury, Height: r.height}, nil
}

var addressAnswer = regexp.MustCompile(`^\("(g1[0-9a-z]+)" [^()]*[Aa]ddress\)$`)

// qevalAddress evaluates an expression whose value is an address.
func (n node) qevalAddress(ctx context.Context, expr string) (string, error) {
	out, err := n.query(ctx, "vm/qeval", expr)
	if err != nil {
		return "", err
	}
	m := addressAnswer.FindStringSubmatch(strings.TrimSpace(out))
	if m == nil {
		return "", fmt.Errorf("%s: not an address: %.80q", expr, out)
	}
	if _, err := crypto.AddressFromBech32(m[1]); err != nil {
		return "", fmt.Errorf("%s: %w", expr, err)
	}
	return m[1], nil
}

// CheckSweep compares a SweepFees transaction's events with the plan: one
// LaunchpadFeesSwept from the sales realm, in ugnot, to the planned treasury,
// paying at least the planned fees (fees only grow until they are swept), and
// one bank transfer out of the sales realm: to that treasury, of exactly that
// amount. It returns the amount swept.
func CheckSweep(plan SweepPlan, events []byte) (*big.Int, error) {
	// Realm events carry type and attrs; the bank's TransferEvent carries
	// from, to and coins (tm2/pkg/sdk/bank/events.go).
	var evs []struct {
		Type    string `json:"type"`
		PkgPath string `json:"pkg_path"`
		Attrs   []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"attrs"`
		From  string `json:"from"`
		To    string `json:"to"`
		Coins []struct {
			Denom  string      `json:"denom"`
			Amount json.Number `json:"amount"`
		} `json:"coins"`
	}
	d := json.NewDecoder(strings.NewReader(string(events)))
	d.UseNumber()
	if err := d.Decode(&evs); err != nil {
		return nil, fmt.Errorf("events: %w", err)
	}
	var found []map[string]string
	sales := realmAddress(salesRealm)
	type transfer struct{ to, coins string }
	var out []transfer
	for _, e := range evs {
		if e.From == sales {
			coins := make([]string, len(e.Coins))
			for i, c := range e.Coins {
				coins[i] = c.Amount.String() + c.Denom
			}
			out = append(out, transfer{e.To, strings.Join(coins, ",")})
		}
		if e.Type != "LaunchpadFeesSwept" || e.PkgPath != salesRealm {
			continue
		}
		attrs := map[string]string{}
		for _, a := range e.Attrs {
			attrs[a.Key] = a.Value
		}
		found = append(found, attrs)
	}
	if len(found) != 1 {
		return nil, fmt.Errorf("%d LaunchpadFeesSwept events from %s, want 1", len(found), salesRealm)
	}
	ev := found[0]
	if ev["currency"] != denom {
		return nil, fmt.Errorf("swept currency %q, want %s", ev["currency"], denom)
	}
	if ev["treasury"] != plan.Treasury {
		return nil, fmt.Errorf("swept to %s, but the treasury read before the sweep was %s", ev["treasury"], plan.Treasury)
	}
	amount, err := parseAmount(ev["amount"])
	if err != nil {
		return nil, fmt.Errorf("swept amount: %w", err)
	}
	if amount.Cmp(plan.Fees) < 0 {
		return nil, fmt.Errorf("swept %s, below the %s owed before the sweep", amount, plan.Fees)
	}
	if want := (transfer{plan.Treasury, amount.String() + denom}); len(out) != 1 || out[0] != want {
		return nil, fmt.Errorf("transfers out of the sales realm %v, want exactly one of %s to %s", out, want.coins, want.to)
	}
	return amount, nil
}

package launchpadwatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"github.com/gnolang/gno/tm2/pkg/crypto"
)

const (
	salesRealm  = "gno.land/r/samcrew/launchpad/sales/v1"
	marketRealm = "gno.land/r/samcrew/launchpad/market/v1"
	denom       = "ugnot"
	offersPage  = 50
	// maxOfferPages bounds one reading: 1,000 pages is 50,000 open offers.
	maxOfferPages = 1000
)

// realmAddress is the address a realm holds its coins at, derived from its path
// (the same on every chain).
func realmAddress(path string) string {
	return crypto.AddressFromPreimage([]byte("pkgPath:" + path)).String()
}

// errUnstable means the books moved under every attempt to read them.
var errUnstable = errors.New("books never held still")

// reading is one stable view of a realm's ugnot books.
type reading struct {
	realm   string
	height  int64
	balance *big.Int
	owed    *big.Int
	// liabilities breaks owed down for the metrics.
	liabilities map[string]*big.Int
	// fields is every value read, for a page.
	fields string
	// problem, when set, says the view is not the one this watcher knows.
	problem string
}

// leg reads one realm's books.
type leg struct {
	realm string
	read  func(w *Watcher, ctx context.Context) (reading, error)
}

func (w *Watcher) legs() []leg {
	return []leg{{salesRealm, (*Watcher).readSales}, {marketRealm, (*Watcher).readMarket}}
}

// readSales takes SolvencyJSON, the bank balance, then SolvencyJSON again. The
// reading is stable when both views are byte-identical and the view's balance
// is the bank's.
func (w *Watcher) readSales(ctx context.Context) (reading, error) {
	expr := salesRealm + `.SolvencyJSON("` + denom + `")`
	for attempt := 0; attempt < w.attempts; attempt++ {
		if attempt > 0 {
			if err := w.pause(ctx, w.retryDelay); err != nil {
				return reading{}, err
			}
		}
		height, err := w.node.checkChain(ctx, w.cfg.ChainID)
		if err != nil {
			return reading{}, err
		}
		s1, err := w.node.qevalString(ctx, expr)
		if err != nil {
			return reading{}, err
		}
		bank, err := w.node.balance(ctx, realmAddress(salesRealm), denom)
		if err != nil {
			return reading{}, err
		}
		s2, err := w.node.qevalString(ctx, expr)
		if err != nil {
			return reading{}, err
		}
		if s1 != s2 {
			continue
		}
		r := salesReading(s1, height)
		if r.problem == "" && r.balance.Cmp(bank) != 0 {
			continue
		}
		return r, nil
	}
	return reading{}, errUnstable
}

// salesReading checks a SolvencyJSON view: its schema, its currency and that
// owed is the sum of its liabilities.
func salesReading(view string, height int64) reading {
	r := reading{realm: salesRealm, height: height, fields: view}
	var v map[string]json.RawMessage
	if err := json.Unmarshal([]byte(view), &v); err != nil {
		r.problem = "malformed view: " + err.Error()
		return r
	}
	var schema, currency string
	if json.Unmarshal(v["schema"], &schema) != nil || schema != "launchpad-sales-solvency-v1" {
		r.problem = fmt.Sprintf("schema is %s, want launchpad-sales-solvency-v1", v["schema"])
		return r
	}
	if json.Unmarshal(v["currency"], &currency) != nil || currency != denom {
		r.problem = fmt.Sprintf("currency is %s, want %s", v["currency"], denom)
		return r
	}
	amounts := map[string]*big.Int{}
	for _, k := range []string{"balance", "owed", "fees", "escrow", "refunds", "proceeds"} {
		var s string
		if err := json.Unmarshal(v[k], &s); err != nil {
			r.problem = fmt.Sprintf("%s is not a decimal string: %s", k, v[k])
			return r
		}
		a, err := parseAmount(s)
		if err != nil {
			r.problem = k + ": " + err.Error()
			return r
		}
		amounts[k] = a
	}
	r.balance, r.owed = amounts["balance"], amounts["owed"]
	r.liabilities = map[string]*big.Int{"fees": amounts["fees"], "escrow": amounts["escrow"], "refunds": amounts["refunds"], "proceeds": amounts["proceeds"]}
	sum := new(big.Int)
	for _, a := range r.liabilities {
		sum.Add(sum, a)
	}
	if sum.Cmp(r.owed) != 0 {
		r.problem = fmt.Sprintf("owed %s is not fees + escrow + refunds + proceeds = %s", r.owed, sum)
	}
	return r
}

// readMarket reads the escrow, the open ugnot offers and the bank balance. Realm
// reads answer at the latest height only, so the reading is stable when two
// passes in a row read the same three values.
func (w *Watcher) readMarket(ctx context.Context) (reading, error) {
	var previous string
	for attempt := 0; attempt < w.attempts+1; attempt++ {
		if attempt > 0 {
			if err := w.pause(ctx, w.retryDelay); err != nil {
				return reading{}, err
			}
		}
		height, err := w.node.checkChain(ctx, w.cfg.ChainID)
		if err != nil {
			return reading{}, err
		}
		escrow, err := w.node.qevalInt(ctx, marketRealm+`.EscrowOf("`+denom+`")`)
		if err != nil {
			return reading{}, err
		}
		offers, priceProblem, err := w.openOffers(ctx)
		if err != nil {
			return reading{}, err
		}
		bank, err := w.node.balance(ctx, realmAddress(marketRealm), denom)
		if err != nil {
			return reading{}, err
		}
		pass := fmt.Sprintf("escrow=%s open-offers=%s balance=%s", escrow, offers, bank)
		if pass != previous {
			previous = pass
			continue
		}
		r := reading{realm: marketRealm, height: height, balance: bank, owed: escrow,
			liabilities: map[string]*big.Int{"offers": escrow}, fields: pass}
		switch {
		case priceProblem != "":
			r.problem = priceProblem
		case offers.Cmp(escrow) != 0:
			r.problem = fmt.Sprintf("open ugnot offers %s are not the escrow %s", offers, escrow)
		}
		return r, nil
	}
	return reading{}, errUnstable
}

// openOffers sums the price of the open ugnot offers, page by page. A price
// that is not a non-negative integer is a view problem, not a read error.
func (w *Watcher) openOffers(ctx context.Context) (*big.Int, string, error) {
	sum, before, seen := new(big.Int), "", map[string]bool{}
	for range maxOfferPages {
		page, err := w.node.qevalString(ctx, fmt.Sprintf(`%s.OffersJSON(%q, %d)`, marketRealm, before, offersPage))
		if err != nil {
			return nil, "", err
		}
		var offers []struct {
			ID       string      `json:"id"`
			Price    json.Number `json:"price"`
			Currency string      `json:"currency"`
		}
		d := json.NewDecoder(bytes.NewReader([]byte(page)))
		d.UseNumber()
		if err := d.Decode(&offers); err != nil {
			return nil, "", fmt.Errorf("offers page: %w", err)
		}
		for _, o := range offers {
			if o.Currency != denom {
				continue
			}
			price, err := parseAmount(o.Price.String())
			if err != nil {
				return nil, fmt.Sprintf("offer %s price: %v", o.ID, err), nil
			}
			sum.Add(sum, price)
		}
		if len(offers) < offersPage {
			return sum, "", nil
		}
		// The cursor must reach a new offer on every page, or the read never ends.
		before = offers[len(offers)-1].ID
		if seen[before] {
			return nil, "", fmt.Errorf("offers cursor %q repeated", before)
		}
		seen[before] = true
	}
	return nil, "", fmt.Errorf("more than %d pages of open offers", maxOfferPages)
}

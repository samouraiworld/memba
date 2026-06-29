package memba_escrow_v1

import (
	"chain"
	"chain/banker"
	"chain/runtime"
	"strconv"
	"strings"
	"time"
)

type EscrowContract struct {
	ID        int
	Buyer     address
	Seller    address
	Title     string
	Amount    int64
	Status    string // "funded", "released", "disputed", "refunded"
	CreatedAt time.Time
}

var (
	contracts []EscrowContract
	nextID    int
)

const (
	FeeRecipient = address("g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v") // Samouraï Coop Multisig
)

// CreateContract initiates an escrow contract.
// Requires ugnot sent in the call matching the price.
func CreateContract(seller address, title string, description string, milestones string) int {
	caller := runtime.OriginCaller()
	sent := banker.OriginSend()

	if len(sent) != 1 || sent[0].Denom != "ugnot" {
		panic("must send exactly one denom (ugnot)")
	}
	amount := sent[0].Amount

	if amount <= 0 {
		panic("amount must be > 0")
	}

	id := nextID
	nextID++

	contracts = append(contracts, EscrowContract{
		ID:        id,
		Buyer:     caller,
		Seller:    seller,
		Title:     title,
		Amount:    amount,
		Status:    "funded",
		CreatedAt: time.Now(),
	})

	return id
}

// ReleaseFunds completes the escrow, sending the funds to the seller (minus 2% fee to protocol).
func ReleaseFunds(id int) {
	if id < 0 || id >= len(contracts) {
		panic("invalid escrow ID")
	}

	c := &contracts[id]
	if c.Status != "funded" {
		panic("escrow is not in funded state")
	}

	caller := runtime.OriginCaller()
	if caller != c.Buyer {
		panic("only buyer can release funds")
	}

	// STATE-BEFORE-SEND INVARIANT (CEI)
	c.Status = "released"

	// Calculate 2% fee
	feeAmount := (c.Amount * 2) / 100
	sellerAmount := c.Amount - feeAmount

	banker_ := banker.NewBanker(banker.BankerTypeRealmSend)
	pkgAddr := runtime.CurrentRealm().Address()

	// Send to seller
	if sellerAmount > 0 {
		banker_.SendCoins(pkgAddr, c.Seller, chain.Coins{{Denom: "ugnot", Amount: sellerAmount}})
	}
	// Send to fee recipient
	if feeAmount > 0 {
		banker_.SendCoins(pkgAddr, FeeRecipient, chain.Coins{{Denom: "ugnot", Amount: feeAmount}})
	}
}

// Refund cancels the escrow, returning funds to the buyer (minus 5% cancellation fee to the seller).
func Refund(id int) {
	if id < 0 || id >= len(contracts) {
		panic("invalid escrow ID")
	}

	c := &contracts[id]
	if c.Status != "funded" {
		panic("escrow is not in funded state")
	}

	caller := runtime.OriginCaller()
	if caller != c.Buyer {
		panic("only buyer can cancel/refund")
	}

	// STATE-BEFORE-SEND INVARIANT (CEI)
	c.Status = "refunded"

	// Calculate 5% cancel fee to seller
	cancelFee := (c.Amount * 5) / 100
	refundAmount := c.Amount - cancelFee

	banker_ := banker.NewBanker(banker.BankerTypeRealmSend)
	pkgAddr := runtime.CurrentRealm().Address()

	// Send cancel fee to seller
	if cancelFee > 0 {
		banker_.SendCoins(pkgAddr, c.Seller, chain.Coins{{Denom: "ugnot", Amount: cancelFee}})
	}
	// Refund buyer
	if refundAmount > 0 {
		banker_.SendCoins(pkgAddr, c.Buyer, chain.Coins{{Denom: "ugnot", Amount: refundAmount}})
	}
}

// Render lists contracts
func Render(path string) string {
	if len(contracts) == 0 {
		return "# Escrow Registry\n\nNo active contracts."
	}

	var sb strings.Builder
	sb.WriteString("# Escrow Registry\n\n")

	for _, c := range contracts {
		sb.WriteString("## Contract #" + strconv.Itoa(c.ID) + ": " + c.Title + "\n")
		sb.WriteString("- **Buyer:** " + c.Buyer.String() + "\n")
		sb.WriteString("- **Seller:** " + c.Seller.String() + "\n")
		sb.WriteString("- **Amount:** " + strconv.FormatInt(c.Amount, 10) + " ugnot\n")
		sb.WriteString("- **Status:** " + c.Status + "\n\n")
	}

	return sb.String()
}

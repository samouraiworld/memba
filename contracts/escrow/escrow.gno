package escrow

// Milestone-based Escrow — On-chain freelance service contracts for Memba.
//
// Flow: CreateContract → FundMilestone → CompleteMilestone → ReleaseFunds
// Disputes: RaiseDispute → admin resolves (or auto-resolves after timeout)
// Timeouts: ClaimRefund (auto-refund if milestone not completed after N blocks)
//           ClaimDisputeTimeout (auto-release to freelancer if admin doesn't act)
//
// Security:
//   - STATE-BEFORE-SEND: All state updates happen before SendCoins calls
//   - FeeRecipient validated in init()
//   - Self-hire prevention: freelancer != client
//   - Input validation: title/description length, milestone amounts > 0
//   - Auto-refund: prevents permanent fund locking
//   - Dispute timeout: prevents permanent dispute locking
//
// Render() contract:
//   Home — Render(""):
//     # Escrow Contracts
//     | ID | Title | Client | Freelancer | Status | Total |
//
//   Detail — Render("contract/ID"):
//     # Title
//     **Client:** g1...
//     **Freelancer:** g1...
//     **Status:** active
//     ## Milestones
//     - **Milestone Title** — 1000000 ugnot [funded]

import (
	"chain"
	"chain/banker"
	"chain/runtime"
	"strconv"
	"strings"

	"gno.land/p/nt/avl/v0"
	"gno.land/p/nt/ufmt/v0"
)

// ── Constants ────────────────────────────────────────────────

const (
	AdminAddress    = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" // samcrew-core-test1 multisig
	FeeRecipient    = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" // Samourai Coop multisig
	PlatformFeePct  = 2  // 2%
	CancelFeePct    = 5  // 5% cancellation fee
	AutoRefundBlks  = int64(864000)  // ~30 days at 3s/block
	AutoResolveBlks = int64(201600)  // ~7 days at 3s/block
	MaxTitleLen     = 200
	MaxDescLen      = 5000
	MaxMilestones   = 20
	MaxContracts    = 500
)

// ── Types ────────────────────────────────────────────────────

type ContractStatus string

const (
	StatusActive    ContractStatus = "active"
	StatusCompleted ContractStatus = "completed"
	StatusDisputed  ContractStatus = "disputed"
	StatusCancelled ContractStatus = "cancelled"
)

type MilestoneStatus string

const (
	MsPending   MilestoneStatus = "pending"
	MsFunded    MilestoneStatus = "funded"
	MsCompleted MilestoneStatus = "completed"
	MsReleased  MilestoneStatus = "released"
	MsDisputed  MilestoneStatus = "disputed"
	MsRefunded  MilestoneStatus = "refunded"
)

type Contract struct {
	ID          string
	Client      address
	Freelancer  address
	Title       string
	Description string
	Status      ContractStatus
	CreatedAt   int64 // block height
	Milestones  []Milestone
}

type Milestone struct {
	ID          int
	Title       string
	Amount      int64 // ugnot
	Status      MilestoneStatus
	FundedAt    int64 // block height (0 if not funded)
	CompletedAt int64 // block height (0 if not completed)
	DisputedAt  int64 // block height (0 if not disputed)
}

// ── State ────────────────────────────────────────────────────

var (
	contracts *avl.Tree // id -> *Contract
	nextID    int
)

func init() {
	contracts = avl.NewTree()

	// Validate FeeRecipient at init — prevents fund-trapping panics later
	if len(FeeRecipient) == 0 {
		panic("FeeRecipient cannot be empty")
	}
}

// ── Contract Lifecycle ──────────────────────────────────────

// CreateContract creates a new escrow contract with milestones.
// Milestones format: "title1:amount1,title2:amount2"
func CreateContract(cur realm, freelancer address, title, description, milestones string) string {
	caller := runtime.PreviousRealm().Address()

	// Validations
	if freelancer == caller {
		panic("cannot hire yourself")
	}
	if len(title) == 0 || len(title) > MaxTitleLen {
		panic(ufmt.Sprintf("title must be 1-%d characters", MaxTitleLen))
	}
	if len(description) > MaxDescLen {
		panic(ufmt.Sprintf("description must be under %d characters", MaxDescLen))
	}
	if contracts.Size() >= MaxContracts {
		panic("contract limit reached")
	}

	ms := parseMilestones(milestones)
	if len(ms) == 0 {
		panic("at least one milestone required")
	}
	if len(ms) > MaxMilestones {
		panic(ufmt.Sprintf("maximum %d milestones allowed", MaxMilestones))
	}

	id := strconv.Itoa(nextID)
	nextID++

	c := &Contract{
		ID:          id,
		Client:      caller,
		Freelancer:  freelancer,
		Title:       title,
		Description: description,
		Status:      StatusActive,
		CreatedAt:   runtime.ChainHeight(),
		Milestones:  ms,
	}
	contracts.Set(id, c)
	return id
}

// FundMilestone deposits funds for a specific milestone. Client only.
func FundMilestone(cur realm, contractId string, milestoneIdx int) {
	caller := runtime.PreviousRealm().Address()
	c := getContract(contractId)

	if c.Client != caller {
		panic("only client can fund")
	}
	if c.Status != StatusActive {
		panic("contract not active")
	}
	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsPending {
		panic("milestone already funded or processed")
	}

	// Verify coins sent
	sent := banker.OriginSend()
	sentAmount := int64(0)
	for _, coin := range sent {
		if coin.Denom == "ugnot" {
			sentAmount = coin.Amount
		}
	}
	if sentAmount != ms.Amount {
		panic(ufmt.Sprintf("must send exactly %d ugnot (sent %d)", ms.Amount, sentAmount))
	}

	ms.Status = MsFunded
	ms.FundedAt = runtime.ChainHeight()
	contracts.Set(contractId, c)
}

// CompleteMilestone marks a milestone as completed. Freelancer only.
func CompleteMilestone(cur realm, contractId string, milestoneIdx int) {
	caller := runtime.PreviousRealm().Address()
	c := getContract(contractId)

	if c.Freelancer != caller {
		panic("only freelancer can mark complete")
	}
	if c.Status == StatusCancelled {
		panic("contract is cancelled")
	}
	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsFunded {
		panic("milestone not funded")
	}

	ms.Status = MsCompleted
	ms.CompletedAt = runtime.ChainHeight()
	contracts.Set(contractId, c)
}

// ReleaseFunds releases funds to freelancer after client approves. Client or Admin.
func ReleaseFunds(cur realm, contractId string, milestoneIdx int) {
	caller := runtime.PreviousRealm().Address()
	c := getContract(contractId)

	if c.Client != caller && caller.String() != AdminAddress {
		panic("only client or admin can release")
	}
	if c.Status == StatusCancelled {
		panic("contract is cancelled")
	}
	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsCompleted {
		panic("milestone not completed")
	}

	// Calculate fees
	platformAmount := (ms.Amount * int64(PlatformFeePct)) / 100
	freelancerAmount := ms.Amount - platformAmount

	// STATE-BEFORE-SEND: update all state before any coin transfers
	ms.Status = MsReleased
	if allMilestonesReleased(c) {
		c.Status = StatusCompleted
	}
	contracts.Set(contractId, c)

	// Transfer funds
	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()

	bnk.SendCoins(realmAddr, c.Freelancer, chain.Coins{chain.NewCoin("ugnot", freelancerAmount)})
	if platformAmount > 0 {
		bnk.SendCoins(realmAddr, address(FeeRecipient), chain.Coins{chain.NewCoin("ugnot", platformAmount)})
	}
}

// ── Disputes ────────────────────────────────────────────────

// RaiseDispute escalates a milestone to admin arbitration. Client or Freelancer.
func RaiseDispute(cur realm, contractId string, milestoneIdx int) {
	caller := runtime.PreviousRealm().Address()
	c := getContract(contractId)

	if c.Client != caller && c.Freelancer != caller {
		panic("only client or freelancer can dispute")
	}
	if c.Status == StatusCancelled || c.Status == StatusCompleted {
		panic("contract is " + string(c.Status))
	}
	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsFunded && ms.Status != MsCompleted {
		panic("can only dispute funded or completed milestones")
	}

	ms.Status = MsDisputed
	ms.DisputedAt = runtime.ChainHeight()
	c.Status = StatusDisputed
	contracts.Set(contractId, c)
}

// ResolveDispute resolves a dispute. Admin only.
// refundClient=true refunds to client, false pays freelancer.
func ResolveDispute(cur realm, contractId string, milestoneIdx int, refundClient bool) {
	caller := runtime.PreviousRealm().Address()
	if caller.String() != AdminAddress {
		panic("only admin can resolve disputes")
	}

	c := getContract(contractId)
	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsDisputed {
		panic("milestone not in dispute")
	}

	// STATE-BEFORE-SEND: update state before transfers
	if refundClient {
		ms.Status = MsRefunded
	} else {
		ms.Status = MsReleased
	}
	// Reset contract status if no other milestones are disputed
	c.Status = StatusActive
	for _, m := range c.Milestones {
		if m.Status == MsDisputed {
			c.Status = StatusDisputed
			break
		}
	}
	if allMilestonesReleased(c) {
		c.Status = StatusCompleted
	}
	contracts.Set(contractId, c)

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()

	if refundClient {
		bnk.SendCoins(realmAddr, c.Client, chain.Coins{chain.NewCoin("ugnot", ms.Amount)})
	} else {
		platformAmount := (ms.Amount * int64(PlatformFeePct)) / 100
		freelancerAmount := ms.Amount - platformAmount
		bnk.SendCoins(realmAddr, c.Freelancer, chain.Coins{chain.NewCoin("ugnot", freelancerAmount)})
		if platformAmount > 0 {
			bnk.SendCoins(realmAddr, address(FeeRecipient), chain.Coins{chain.NewCoin("ugnot", platformAmount)})
		}
	}
}

// ── Cancellation ────────────────────────────────────────────

// CancelContract cancels an active contract. Client only.
// Funded milestones are refunded minus cancellation fee.
func CancelContract(cur realm, contractId string) {
	caller := runtime.PreviousRealm().Address()
	c := getContract(contractId)

	if c.Client != caller {
		panic("only client can cancel")
	}
	if c.Status != StatusActive {
		panic("contract not active")
	}

	// STATE-BEFORE-SEND: update all state before transfers
	// Funded milestones → refunded (client gets back minus cancellation fee)
	// Completed milestones → released (freelancer already did the work, they get paid)
	c.Status = StatusCancelled
	for i := range c.Milestones {
		if c.Milestones[i].Status == MsFunded {
			c.Milestones[i].Status = MsRefunded
		} else if c.Milestones[i].Status == MsCompleted {
			c.Milestones[i].Status = MsReleased
		}
	}
	contracts.Set(contractId, c)

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()

	for _, ms := range c.Milestones {
		// Refund funded milestones minus cancellation fee
		if ms.Status == MsRefunded && ms.FundedAt > 0 {
			fee := (ms.Amount * int64(CancelFeePct)) / 100
			refund := ms.Amount - fee
			if refund > 0 {
				bnk.SendCoins(realmAddr, c.Client, chain.Coins{chain.NewCoin("ugnot", refund)})
			}
			// Cancellation fee goes to freelancer as compensation for lost opportunity
			if fee > 0 {
				bnk.SendCoins(realmAddr, c.Freelancer, chain.Coins{chain.NewCoin("ugnot", fee)})
			}
		}
		// Pay freelancer for completed work (full amount minus platform fee)
		if ms.Status == MsReleased && ms.CompletedAt > 0 {
			platformAmount := (ms.Amount * int64(PlatformFeePct)) / 100
			freelancerAmount := ms.Amount - platformAmount
			bnk.SendCoins(realmAddr, c.Freelancer, chain.Coins{chain.NewCoin("ugnot", freelancerAmount)})
			if platformAmount > 0 {
				bnk.SendCoins(realmAddr, address(FeeRecipient), chain.Coins{chain.NewCoin("ugnot", platformAmount)})
			}
		}
	}
}

// ── Timeouts (permissionless) ───────────────────────────────

// ClaimRefund refunds a funded milestone that has timed out.
// Anyone can call — permissionless, prevents fund locking.
func ClaimRefund(cur realm, contractId string, milestoneIdx int) {
	c := getContract(contractId)

	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsFunded {
		panic("milestone not funded")
	}
	if ms.FundedAt == 0 {
		panic("milestone has no funding record")
	}

	elapsed := runtime.ChainHeight() - ms.FundedAt
	if elapsed < AutoRefundBlks {
		panic(ufmt.Sprintf("too early: %d blocks remaining", AutoRefundBlks-elapsed))
	}

	// STATE-BEFORE-SEND
	ms.Status = MsRefunded
	// Update contract status if all milestones are now terminal
	if allMilestonesTerminal(c) {
		c.Status = StatusCancelled
	}
	contracts.Set(contractId, c)

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	bnk.SendCoins(
		runtime.CurrentRealm().Address(),
		c.Client,
		chain.Coins{chain.NewCoin("ugnot", ms.Amount)},
	)
}

// ClaimDisputeTimeout auto-resolves a dispute that admin hasn't acted on.
// Releases funds to freelancer after AutoResolveBlks. Anyone can call.
func ClaimDisputeTimeout(cur realm, contractId string, milestoneIdx int) {
	c := getContract(contractId)

	if milestoneIdx < 0 || milestoneIdx >= len(c.Milestones) {
		panic("invalid milestone index")
	}

	ms := &c.Milestones[milestoneIdx]
	if ms.Status != MsDisputed {
		panic("milestone not in dispute")
	}
	if ms.DisputedAt == 0 {
		panic("milestone has no dispute record")
	}

	elapsed := runtime.ChainHeight() - ms.DisputedAt
	if elapsed < AutoResolveBlks {
		panic(ufmt.Sprintf("too early: %d blocks remaining", AutoResolveBlks-elapsed))
	}

	// STATE-BEFORE-SEND: auto-resolve in favor of freelancer
	platformAmount := (ms.Amount * int64(PlatformFeePct)) / 100
	freelancerAmount := ms.Amount - platformAmount

	ms.Status = MsReleased
	// Reset contract status
	c.Status = StatusActive
	for _, m := range c.Milestones {
		if m.Status == MsDisputed {
			c.Status = StatusDisputed
			break
		}
	}
	if allMilestonesReleased(c) {
		c.Status = StatusCompleted
	}
	contracts.Set(contractId, c)

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()

	bnk.SendCoins(realmAddr, c.Freelancer, chain.Coins{chain.NewCoin("ugnot", freelancerAmount)})
	if platformAmount > 0 {
		bnk.SendCoins(realmAddr, address(FeeRecipient), chain.Coins{chain.NewCoin("ugnot", platformAmount)})
	}
}

// ── Render ───────────────────────────────────────────────────

func Render(path string) string {
	if path == "" {
		return renderHome()
	}
	if strings.HasPrefix(path, "contract/") {
		id := strings.TrimPrefix(path, "contract/")
		return renderContract(id)
	}
	if path == "stats" {
		return renderStats()
	}
	return "# 404\nNot found: " + path
}

func renderHome() string {
	var sb strings.Builder
	sb.WriteString("# Escrow Contracts\n\n")
	sb.WriteString("Milestone-based escrow for freelance services on Gno.\n\n")

	if contracts.Size() == 0 {
		sb.WriteString("*No contracts yet.*\n")
		return sb.String()
	}

	sb.WriteString("| ID | Title | Client | Freelancer | Status | Total |\n")
	sb.WriteString("| --- | --- | --- | --- | --- | --- |\n")

	contracts.Iterate("", "", func(key string, value interface{}) bool {
		c := value.(*Contract)
		total := int64(0)
		for _, ms := range c.Milestones {
			total += ms.Amount
		}
		sb.WriteString(ufmt.Sprintf("| %s | [%s](:contract/%s) | %s | %s | %s | %d ugnot |\n",
			c.ID, c.Title, c.ID, truncAddr(c.Client), truncAddr(c.Freelancer),
			string(c.Status), total))
		return false
	})

	return sb.String()
}

func renderContract(id string) string {
	val, exists := contracts.Get(id)
	if !exists {
		return "# 404\nContract not found: " + id
	}
	c := val.(*Contract)

	var sb strings.Builder
	sb.WriteString("# " + c.Title + "\n\n")
	if len(c.Description) > 0 {
		sb.WriteString(c.Description + "\n\n")
	}
	sb.WriteString("**ID:** " + c.ID + "\n")
	sb.WriteString("**Client:** " + c.Client.String() + "\n")
	sb.WriteString("**Freelancer:** " + c.Freelancer.String() + "\n")
	sb.WriteString("**Status:** " + string(c.Status) + "\n")
	sb.WriteString("**Created:** block " + strconv.FormatInt(c.CreatedAt, 10) + "\n\n")

	total := int64(0)
	for _, ms := range c.Milestones {
		total += ms.Amount
	}
	sb.WriteString("**Total Value:** " + strconv.FormatInt(total, 10) + " ugnot\n\n")

	sb.WriteString("## Milestones\n\n")
	for _, ms := range c.Milestones {
		sb.WriteString(ufmt.Sprintf("- **%s** — %d ugnot [%s]",
			ms.Title, ms.Amount, string(ms.Status)))
		if ms.FundedAt > 0 {
			sb.WriteString(ufmt.Sprintf(" (funded block %d)", ms.FundedAt))
		}
		if ms.CompletedAt > 0 {
			sb.WriteString(ufmt.Sprintf(" (completed block %d)", ms.CompletedAt))
		}
		if ms.DisputedAt > 0 {
			sb.WriteString(ufmt.Sprintf(" (disputed block %d)", ms.DisputedAt))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

func renderStats() string {
	var sb strings.Builder
	sb.WriteString("# Escrow Stats\n\n")

	totalContracts := contracts.Size()
	active, completed, disputed, cancelled := 0, 0, 0, 0
	totalValue := int64(0)

	contracts.Iterate("", "", func(key string, value interface{}) bool {
		c := value.(*Contract)
		switch c.Status {
		case StatusActive:
			active++
		case StatusCompleted:
			completed++
		case StatusDisputed:
			disputed++
		case StatusCancelled:
			cancelled++
		}
		for _, ms := range c.Milestones {
			totalValue += ms.Amount
		}
		return false
	})

	sb.WriteString(ufmt.Sprintf("**Total Contracts:** %d\n", totalContracts))
	sb.WriteString(ufmt.Sprintf("**Active:** %d | **Completed:** %d | **Disputed:** %d | **Cancelled:** %d\n", active, completed, disputed, cancelled))
	sb.WriteString(ufmt.Sprintf("**Total Value:** %d ugnot\n", totalValue))

	return sb.String()
}

// ── Helpers ──────────────────────────────────────────────────

func getContract(id string) *Contract {
	val, exists := contracts.Get(id)
	if !exists {
		panic("contract not found: " + id)
	}
	return val.(*Contract)
}

func allMilestonesReleased(c *Contract) bool {
	for _, m := range c.Milestones {
		if m.Status != MsReleased {
			return false
		}
	}
	return true
}

// allMilestonesTerminal returns true if every milestone is in a final state
// (released, refunded, or pending — pending with no funds is terminal).
func allMilestonesTerminal(c *Contract) bool {
	for _, m := range c.Milestones {
		if m.Status == MsFunded || m.Status == MsCompleted || m.Status == MsDisputed {
			return false
		}
	}
	return true
}

// parseMilestones parses "title1:amount1,title2:amount2" into Milestone slice.
// Invalid entries cause a panic (not silently skipped).
func parseMilestones(input string) []Milestone {
	var result []Milestone
	parts := strings.Split(input, ",")
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if len(p) == 0 {
			continue
		}
		kv := strings.SplitN(p, ":", 2)
		if len(kv) != 2 {
			panic(ufmt.Sprintf("invalid milestone format at position %d: expected 'title:amount'", i))
		}
		title := strings.TrimSpace(kv[0])
		if len(title) == 0 {
			panic(ufmt.Sprintf("empty milestone title at position %d", i))
		}
		amount, err := strconv.ParseInt(strings.TrimSpace(kv[1]), 10, 64)
		if err != nil || amount <= 0 {
			panic(ufmt.Sprintf("invalid milestone amount at position %d: must be positive integer", i))
		}
		result = append(result, Milestone{
			ID:     i,
			Title:  title,
			Amount: amount,
			Status: MsPending,
		})
	}
	return result
}

func truncAddr(addr address) string {
	s := addr.String()
	if len(s) > 13 {
		return s[:10] + "..."
	}
	return s
}

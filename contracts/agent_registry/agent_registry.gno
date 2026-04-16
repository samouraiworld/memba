package agent_registry

// Agent Registry — On-chain AI Agent Marketplace for the Memba ecosystem.
//
// Agents self-register with MCP metadata (endpoint, transport, pricing).
// Anyone can query via Render() for agent listings.
// Reviews are stored on-chain with 1-5 star ratings.
// Pay-per-use agents support a prepaid credit system.
//
// Render() contract:
//
//   Home — Render(""):
//     # Memba Agent Registry
//     description
//     ## Agents
//     | ID | Name | Category | Rating | Pricing |
//     | --- | --- | --- | --- | --- |
//     | id | name | category | 4.2 (5) | free |
//
//   Agent — Render("agent/id"):
//     # AgentName
//     description
//     **Category:** category
//     **Creator:** g1addr
//     **Endpoint:** endpoint
//     **Transport:** stdio|sse|streamable-http
//     **Pricing:** free|pay-per-use|subscription
//     **Rating:** 4.2 (5 reviews)
//     ## Capabilities
//     - capability1
//     - capability2
//     ## Reviews
//     **g1addr...** stars (block H)
//     review text
//
//   Stats — Render("stats"):
//     Total agents, total reviews, total calls

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
	MaxAgents    = 100
	MaxNameLen   = 100
	MaxDescLen   = 1000
	MaxCapsLen   = 2000
	MaxReviewLen = 500
	AdminAddress = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" // samcrew-core-test1 multisig
)

// ── Types ────────────────────────────────────────────────────

type Agent struct {
	ID           string
	Name         string
	Description  string
	Category     string
	Capabilities string // comma-separated
	Creator      address
	Endpoint     string
	Transport    string // "stdio" | "sse" | "streamable-http"
	Pricing      string // "free" | "pay-per-use" | "subscription"
	PricePerCall int64  // in ugnot (0 if free)
	Version      string
	TotalCalls   int64
	RatingSum    int64
	RatingCount  int64
	BlockH       int64
}

type Review struct {
	Reviewer address
	Rating   int // 1-5
	Comment  string
	BlockH   int64
}

// ── State ────────────────────────────────────────────────────

var (
	agents  *avl.Tree // id -> *Agent
	reviews *avl.Tree // agentId -> []*Review
	credits *avl.Tree // "agentId/userAddr" -> int64 (prepaid credits in ugnot)
	usage   *avl.Tree // "agentId/userAddr" -> int64 (total calls)
)

func init() {
	agents = avl.NewTree()
	reviews = avl.NewTree()
	credits = avl.NewTree()
	usage = avl.NewTree()
}

// ── Public Functions ─────────────────────────────────────────

// RegisterAgent registers a new agent in the registry.
func RegisterAgent(
	cur realm,
	id, name, description, category, capabilities,
	endpoint, transport, pricing, version string,
	pricePerCall int64,
) {
	caller := runtime.PreviousRealm().Address()

	if _, exists := agents.Get(id); exists {
		panic("agent ID already exists: " + id)
	}
	if len(id) == 0 || len(id) > 50 {
		panic("ID must be 1-50 characters")
	}
	if len(name) == 0 || len(name) > MaxNameLen {
		panic(ufmt.Sprintf("name must be 1-%d characters", MaxNameLen))
	}
	if len(description) > MaxDescLen {
		panic("description too long")
	}
	if len(capabilities) > MaxCapsLen {
		panic("capabilities too long")
	}
	if agents.Size() >= MaxAgents {
		panic("registry full")
	}
	if !isValidTransport(transport) {
		panic("transport must be stdio, sse, or streamable-http")
	}
	if !isValidPricing(pricing) {
		panic("pricing must be free, pay-per-use, or subscription")
	}

	a := &Agent{
		ID:           id,
		Name:         name,
		Description:  description,
		Category:     category,
		Capabilities: capabilities,
		Creator:      caller,
		Endpoint:     endpoint,
		Transport:    transport,
		Pricing:      pricing,
		PricePerCall: pricePerCall,
		Version:      version,
		BlockH:       runtime.ChainHeight(),
	}
	agents.Set(id, a)
	reviews.Set(id, []*Review{})
}

// UpdateAgent allows the creator to update their agent.
func UpdateAgent(
	cur realm,
	id, description, capabilities, endpoint, version, pricing string,
	pricePerCall int64,
) {
	caller := runtime.PreviousRealm().Address()
	val, exists := agents.Get(id)
	if !exists {
		panic("agent not found: " + id)
	}
	a := val.(*Agent)
	if a.Creator != caller {
		panic("only the creator can update")
	}
	if len(description) > 0 {
		if len(description) > MaxDescLen {
			panic("description too long")
		}
		a.Description = description
	}
	if len(capabilities) > 0 {
		if len(capabilities) > MaxCapsLen {
			panic("capabilities too long")
		}
		a.Capabilities = capabilities
	}
	if len(endpoint) > 0 {
		a.Endpoint = endpoint
	}
	if len(version) > 0 {
		a.Version = version
	}
	if len(pricing) > 0 {
		if !isValidPricing(pricing) {
			panic("pricing must be free, pay-per-use, or subscription")
		}
		a.Pricing = pricing
	}
	a.PricePerCall = pricePerCall
	agents.Set(id, a)
}

// ReviewAgent adds a review for an agent.
func ReviewAgent(cur realm, agentId string, rating int, comment string) {
	caller := runtime.PreviousRealm().Address()

	val, exists := agents.Get(agentId)
	if !exists {
		panic("agent not found")
	}
	if rating < 1 || rating > 5 {
		panic("rating must be 1-5")
	}
	if len(comment) > MaxReviewLen {
		panic("review too long")
	}

	a := val.(*Agent)
	a.RatingSum += int64(rating)
	a.RatingCount++
	agents.Set(agentId, a)

	rval, _ := reviews.Get(agentId)
	revs := rval.([]*Review)
	revs = append(revs, &Review{
		Reviewer: caller,
		Rating:   rating,
		Comment:  comment,
		BlockH:   runtime.ChainHeight(),
	})
	reviews.Set(agentId, revs)
}

// RemoveAgent removes an agent (admin or creator only).
func RemoveAgent(cur realm, id string) {
	caller := runtime.PreviousRealm().Address()
	val, exists := agents.Get(id)
	if !exists {
		panic("agent not found")
	}
	a := val.(*Agent)
	if a.Creator != caller && caller.String() != AdminAddress {
		panic("only creator or admin can remove")
	}
	agents.Remove(id)
	reviews.Remove(id)
}

// ── Pay-Per-Use Credit System ────────────────────────────────

// DepositCredits deposits GNOT as prepaid credits for an agent.
// Send ugnot with the transaction to fund the credits.
func DepositCredits(cur realm, agentId string) {
	caller := runtime.PreviousRealm().Address()
	if _, exists := agents.Get(agentId); !exists {
		panic("agent not found")
	}

	sent := banker.OriginSend()
	amount := int64(0)
	for _, coin := range sent {
		if coin.Denom == "ugnot" {
			amount = coin.Amount
		}
	}
	if amount == 0 {
		panic("must send ugnot to deposit credits")
	}

	key := agentId + "/" + caller.String()
	existing := int64(0)
	if val, ok := credits.Get(key); ok {
		existing = val.(int64)
	}
	credits.Set(key, existing+amount)
}

// UseCredit deducts one invocation credit. Called by the agent service.
// Returns the remaining credits.
func UseCredit(cur realm, agentId, userAddr string) int64 {
	val, exists := agents.Get(agentId)
	if !exists {
		panic("agent not found")
	}
	a := val.(*Agent)

	key := agentId + "/" + userAddr
	if a.Pricing == "pay-per-use" && a.PricePerCall > 0 {
		cval, cexists := credits.Get(key)
		if !cexists {
			panic("no credits deposited")
		}
		balance := cval.(int64)
		if balance < a.PricePerCall {
			panic(ufmt.Sprintf("insufficient credits: %d < %d", balance, a.PricePerCall))
		}
		credits.Set(key, balance-a.PricePerCall)
	}

	// Track usage
	a.TotalCalls++
	agents.Set(agentId, a)

	uval := int64(0)
	if uv, uok := usage.Get(key); uok {
		uval = uv.(int64)
	}
	usage.Set(key, uval+1)

	remaining := int64(0)
	if rv, rok := credits.Get(key); rok {
		remaining = rv.(int64)
	}
	return remaining
}

// GetCredits returns the credit balance for a user on an agent.
func GetCredits(agentId, userAddr string) int64 {
	key := agentId + "/" + userAddr
	if val, ok := credits.Get(key); ok {
		return val.(int64)
	}
	return 0
}

// GetUsage returns the total invocation count for a user on an agent.
func GetUsage(agentId, userAddr string) int64 {
	key := agentId + "/" + userAddr
	if val, ok := usage.Get(key); ok {
		return val.(int64)
	}
	return 0
}

// RefundCredits refunds remaining credits to the caller.
func RefundCredits(cur realm, agentId string) {
	caller := runtime.PreviousRealm().Address()
	key := agentId + "/" + caller.String()

	cval, cexists := credits.Get(key)
	if !cexists {
		panic("no credits to refund")
	}
	balance := cval.(int64)
	if balance == 0 {
		panic("zero balance")
	}

	// STATE-BEFORE-SEND: update state before coin transfer to prevent reentrancy
	credits.Set(key, int64(0))

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	bnk.SendCoins(
		runtime.CurrentRealm().Address(),
		caller,
		chain.Coins{chain.NewCoin("ugnot", balance)},
	)
}

// ── Render ───────────────────────────────────────────────────

const renderPageSize = 20

func Render(path string) string {
	if path == "" {
		return renderHome(0)
	}
	if strings.HasPrefix(path, "page:") {
		page, err := strconv.Atoi(strings.TrimPrefix(path, "page:"))
		if err == nil && page >= 0 {
			return renderHome(page)
		}
	}
	if path == "stats" {
		return renderStats()
	}
	if strings.HasPrefix(path, "agent/") {
		agentId := strings.TrimPrefix(path, "agent/")
		return renderAgent(agentId)
	}
	return "# 404\nNot found: " + path
}

func renderHome(page int) string {
	var sb strings.Builder
	sb.WriteString("# Memba Agent Registry\n\n")
	sb.WriteString("On-chain AI Agent Marketplace for the Gno ecosystem.\n\n")

	if agents.Size() == 0 {
		sb.WriteString("*No agents registered yet.*\n")
		return sb.String()
	}

	sb.WriteString("## Agents\n\n")
	sb.WriteString("| ID | Name | Category | Rating | Pricing |\n")
	sb.WriteString("| --- | --- | --- | --- | --- |\n")

	skip := page * renderPageSize
	shown := 0
	skipped := 0
	agents.Iterate("", "", func(key string, value interface{}) bool {
		if skipped < skip {
			skipped++
			return false
		}
		if shown >= renderPageSize {
			return true // stop
		}
		a := value.(*Agent)
		rating := "unrated"
		if a.RatingCount > 0 {
			rating = formatRating(a.RatingSum, a.RatingCount)
		}
		pricing := a.Pricing
		if a.Pricing == "pay-per-use" && a.PricePerCall > 0 {
			pricing = ufmt.Sprintf("pay-per-use (%d ugnot)", a.PricePerCall)
		}
		sb.WriteString(ufmt.Sprintf("| %s | [%s](:agent/%s) | %s | %s | %s |\n",
			a.ID, a.Name, a.ID, a.Category, rating, pricing))
		shown++
		return false
	})

	// Pagination footer
	totalPages := (agents.Size() + renderPageSize - 1) / renderPageSize
	if totalPages > 1 {
		sb.WriteString(ufmt.Sprintf("\n---\nPage %d/%d\n", page+1, totalPages))
	}

	return sb.String()
}

func renderAgent(id string) string {
	val, exists := agents.Get(id)
	if !exists {
		return "# 404\nAgent not found: " + id
	}
	a := val.(*Agent)

	var sb strings.Builder
	sb.WriteString("# " + a.Name + "\n\n")
	sb.WriteString(a.Description + "\n\n")
	sb.WriteString("**ID:** " + a.ID + "\n")
	sb.WriteString("**Category:** " + a.Category + "\n")
	sb.WriteString("**Creator:** " + a.Creator.String() + "\n")
	sb.WriteString("**Endpoint:** " + a.Endpoint + "\n")
	sb.WriteString("**Transport:** " + a.Transport + "\n")
	sb.WriteString("**Pricing:** " + a.Pricing + "\n")
	if a.PricePerCall > 0 {
		sb.WriteString("**Price:** " + strconv.FormatInt(a.PricePerCall, 10) + " ugnot/call\n")
	}
	sb.WriteString("**Version:** " + a.Version + "\n")
	sb.WriteString("**Total Calls:** " + strconv.FormatInt(a.TotalCalls, 10) + "\n")
	sb.WriteString("**Registered:** block " + strconv.FormatInt(a.BlockH, 10) + "\n")

	if a.RatingCount > 0 {
		sb.WriteString("**Rating:** " + formatRating(a.RatingSum, a.RatingCount) +
			" (" + strconv.FormatInt(a.RatingCount, 10) + " reviews)\n")
	}

	// Capabilities
	sb.WriteString("\n## Capabilities\n\n")
	for _, cap := range strings.Split(a.Capabilities, ",") {
		cap = strings.TrimSpace(cap)
		if len(cap) > 0 {
			sb.WriteString("- " + cap + "\n")
		}
	}

	// Reviews
	rval, rexists := reviews.Get(id)
	if rexists {
		revs := rval.([]*Review)
		if len(revs) > 0 {
			sb.WriteString("\n## Reviews\n\n")
			for _, r := range revs {
				stars := strings.Repeat("*", r.Rating) + strings.Repeat(".", 5-r.Rating)
				sb.WriteString(ufmt.Sprintf("**%s** [%s] (block %d)\n\n",
					truncAddr(r.Reviewer), stars, r.BlockH))
				if len(r.Comment) > 0 {
					sb.WriteString(r.Comment + "\n\n")
				}
				sb.WriteString("---\n\n")
			}
		}
	}

	return sb.String()
}

func renderStats() string {
	var sb strings.Builder
	sb.WriteString("# Registry Stats\n\n")

	totalAgents := agents.Size()
	totalReviews := int64(0)
	totalCalls := int64(0)

	agents.Iterate("", "", func(key string, value interface{}) bool {
		a := value.(*Agent)
		totalReviews += a.RatingCount
		totalCalls += a.TotalCalls
		return false
	})

	sb.WriteString(ufmt.Sprintf("**Total Agents:** %d\n", totalAgents))
	sb.WriteString(ufmt.Sprintf("**Total Reviews:** %d\n", totalReviews))
	sb.WriteString(ufmt.Sprintf("**Total Calls:** %d\n", totalCalls))

	return sb.String()
}

// ── Helpers ──────────────────────────────────────────────────

// formatRating formats a rating as "X.Y" using integer math (no float in ufmt).
func formatRating(sum, count int64) string {
	if count == 0 {
		return "0.0"
	}
	whole := sum / count
	// One decimal place: (sum * 10 / count) % 10
	frac := ((sum * 10) / count) % 10
	return strconv.FormatInt(whole, 10) + "." + strconv.FormatInt(frac, 10)
}

func truncAddr(addr address) string {
	s := addr.String()
	if len(s) > 13 {
		return s[:10] + "..."
	}
	return s
}

func isValidTransport(t string) bool {
	return t == "stdio" || t == "sse" || t == "streamable-http"
}

func isValidPricing(p string) bool {
	return p == "free" || p == "pay-per-use" || p == "subscription"
}

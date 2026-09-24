// Package memba_weighted_policy implements the approved founding coalition and delay
// rules. The hosting DAO must authenticate callers, classify and freeze typed
// actions, and keep every Policy and Proposal private. This package grants no
// authority over a realm and is not a replacement for those integration gates.
package memba_weighted_policy

import (
	"strings"
	"time"
)

type Category string

const (
	Routine   Category = "routine"
	Financial Category = "financial"
	Critical  Category = "critical"
)

// VotingPeriod is fixed by the approved founding policy, not proposer input.
const VotingPeriod = 7 * 24 * time.Hour

type Vote string

const (
	Yes     Vote = "yes"
	No      Vote = "no"
	Abstain Vote = "abstain"
)

// PersonID is the directory's unique human identity, never a wallet alias.
// The host must establish that different PersonIDs really are different people.
type Member struct {
	PersonID string
	Address  address
	Founder  bool
}

// Policy fixes one founding seven-person roster. Reconfiguration deliberately
// invalidates every pending proposal, including already mature proposals.
// Only a reviewed critical-action handler in the host may call Reconfigure.
type Policy struct {
	members    [7]Member
	generation uint64
}

func New(members []Member) *Policy {
	return &Policy{members: validateRoster(members), generation: 1}
}

func validateRoster(members []Member) [7]Member {
	if len(members) != 7 {
		panic("policy requires seven people")
	}
	var roster [7]Member
	founders := 0
	for i, m := range members {
		if m.PersonID == "" || strings.TrimSpace(m.PersonID) != m.PersonID || !m.Address.IsValid() {
			panic("invalid member identity")
		}
		for j := 0; j < i; j++ {
			if roster[j].PersonID == m.PersonID || roster[j].Address == m.Address {
				panic("duplicate person or address")
			}
		}
		if m.Founder {
			founders++
		}
		roster[i] = m
	}
	if founders != 1 {
		panic("policy requires one founder and six developers")
	}
	return roster
}

// Reconfigure is a host-only operation, not an authenticated public DAO API.
// It preserves the approved seven seats and 2/1 weights. Invalid input cannot
// mutate the roster or invalidate proposals, even if the host recovers a panic.
func (p *Policy) Reconfigure(members []Member) {
	roster := validateRoster(members)
	if p.generation == ^uint64(0) {
		panic("policy generation exhausted")
	}
	p.members = roster
	p.generation++
}

func (p *Policy) memberIndex(who address) int {
	if p.generation == 0 {
		return -1
	}
	for i, m := range p.members {
		if m.Address == who {
			return i
		}
	}
	return -1
}

// MayPause establishes member eligibility only. The host must dispatch only a
// typed, allowlisted pause operation; this is never spend or unpause authority.
func (p *Policy) MayPause(who address) bool { return p.memberIndex(who) >= 0 }

// Proposal freezes the category, exact action bytes and roster generation.
// The host determines the category from the action handler, never user input.
// Each proposal has its own vote storage and qualification clocks.
// yesSince[i] is the start of seat i's current uninterrupted YES ballot and is
// meaningful only while votes[i] is Yes.
type Proposal struct {
	policy         *Policy
	generation     uint64
	category       Category
	action         string
	votes          [7]Vote
	yesSince       [7]time.Time
	createdAt      time.Time
	votingDeadline time.Time
	lastChange     time.Time
	consumed       bool
}

func (p *Policy) NewProposal(category Category, action string) *Proposal {
	if p.generation == 0 {
		panic("uninitialized policy")
	}
	if category != Routine && category != Financial && category != Critical {
		panic("unknown action category")
	}
	if action == "" {
		panic("empty action")
	}
	now := time.Now()
	return &Proposal{policy: p, generation: p.generation, category: category, action: action, createdAt: now, votingDeadline: now.Add(VotingPeriod), lastChange: now}
}

func (p *Proposal) assertActive() {
	if p.consumed || p.generation != p.policy.generation {
		panic("proposal consumed or invalidated")
	}
}

// Vote requires a caller identity already authenticated by the host realm.
// Voting closes at the deadline, including changes to existing ballots.
// A critical route starts when some coalition that is still voting YES without
// interruption first met its threshold. A withdrawal moves the clock only when
// every such coalition needed that ballot, so voters the rest of the YES set
// does not need cannot postpone execution by withdrawing and rejoining.
func (p *Proposal) Vote(who address, vote Vote) {
	p.assertActive()
	i := p.policy.memberIndex(who)
	if i < 0 {
		panic("voter is not a member")
	}
	if vote != Yes && vote != No && vote != Abstain {
		panic("invalid vote")
	}
	now := time.Now()
	if now.Before(p.lastChange) {
		panic("chain time regressed")
	}
	if !now.Before(p.votingDeadline) {
		panic("voting closed")
	}
	if p.votes[i] == vote {
		return
	}
	p.votes[i] = vote
	p.lastChange = now
	if vote == Yes {
		p.yesSince[i] = now
	}
}

// qualifiedSince returns the earliest start of an uninterrupted YES coalition
// meeting the weighted (6 points, 4 people) or developer (5 developers)
// critical threshold, or the zero time when no current coalition qualifies.
// Candidate starts are the seats' own streak starts; the coalition for a
// candidate is every current YES ballot that began no later than it.
func (p *Proposal) qualifiedSince(developersOnly bool) time.Time {
	var earliest time.Time
	for c, candidate := range p.votes {
		if candidate != Yes {
			continue
		}
		start := p.yesSince[c]
		if !earliest.IsZero() && !start.Before(earliest) {
			continue
		}
		weight, people := 0, 0
		for j, vote := range p.votes {
			if vote != Yes || p.yesSince[j].After(start) {
				continue
			}
			founder := p.policy.members[j].Founder
			if developersOnly && founder {
				continue
			}
			people++
			weight++
			if founder {
				weight++
			}
		}
		if developersOnly && people >= 5 || !developersOnly && weight >= 6 && people >= 4 {
			earliest = start
		}
	}
	return earliest
}

func (p *Proposal) tally() (weight, people, developers int) {
	for i, vote := range p.votes {
		if vote != Yes {
			continue
		}
		people++
		weight++
		if p.policy.members[i].Founder {
			weight++
		} else {
			developers++
		}
	}
	return
}

// State is a copy for rendering. Reading never starts or advances a clock.
// An invalidated proposal reports no current tally or execution authorization.
type State struct {
	Category       Category
	CreatedAt      time.Time
	VotingDeadline time.Time
	VotingClosed   bool
	Qualified      bool
	Expired        bool
	WeightYes      int
	PeopleYes      int
	DevelopersYes  int
	WeightedAfter  time.Time
	DeveloperAfter time.Time
	Invalidated    bool
	Consumed       bool
	Ready          bool
}

func (p *Proposal) State() State {
	now := time.Now()
	s := State{Category: p.category, CreatedAt: p.createdAt, VotingDeadline: p.votingDeadline, VotingClosed: !now.Before(p.votingDeadline), Invalidated: p.generation != p.policy.generation, Consumed: p.consumed}
	if s.Invalidated || s.Consumed {
		return s
	}
	s.WeightYes, s.PeopleYes, s.DevelopersYes = p.tally()
	if now.Before(p.lastChange) {
		return s
	}
	switch p.category {
	case Routine:
		s.Qualified = s.WeightYes >= 3 && s.PeopleYes >= 2
		s.Ready = s.Qualified
	case Financial:
		s.Qualified = s.WeightYes >= 5 && s.PeopleYes >= 3
		s.Ready = s.Qualified
	case Critical:
		weightedSince := p.qualifiedSince(false)
		developerSince := p.qualifiedSince(true)
		s.Qualified = !weightedSince.IsZero() || !developerSince.IsZero()
		if !weightedSince.IsZero() {
			s.WeightedAfter = weightedSince.Add(24 * time.Hour)
			s.Ready = !now.Before(s.WeightedAfter)
		}
		if !developerSince.IsZero() {
			s.DeveloperAfter = developerSince.Add(72 * time.Hour)
			s.Ready = s.Ready || !now.Before(s.DeveloperAfter)
		}
	}
	// Ballots are immutable after closing. A pre-deadline qualification can
	// finish its existing delay afterward; an unqualified ballot cannot revive.
	s.Expired = s.VotingClosed && !s.Qualified
	return s
}

// Consume binds execution to the frozen action and marks it consumed BEFORE
// the host invokes its typed handler. The host must let handler failure abort
// the transaction: recovering a panic does not roll back Gno realm state.
// Caller authentication and current-member executor eligibility belong to the
// host. Do not expose Proposal pointers or call Consume from a read endpoint.
func (p *Proposal) Consume(action string) {
	p.assertActive()
	if action != p.action {
		panic("action changed")
	}
	if !p.State().Ready {
		panic("proposal is not ready")
	}
	p.consumed = true
}

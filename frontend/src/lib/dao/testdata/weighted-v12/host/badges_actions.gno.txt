package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const BadgesPath = "gno.land/r/samcrew/gnobuilders_badges_v2"

type BadgesActionKind string

const (
	BadgesAcceptOwner BadgesActionKind = "accept-owner"
	BadgesReturnOwner BadgesActionKind = "return-owner"
	BadgesAbortReturn BadgesActionKind = "abort-return"
	BadgesAddAdmin    BadgesActionKind = "add-admin"
	BadgesRemoveAdmin BadgesActionKind = "remove-admin"
	BadgesUnpause     BadgesActionKind = "unpause"
)

type BadgesPolicy struct{ dao, successor address }

func NewBadgesPolicy(dao, successor address) BadgesPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("badges policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(BadgesPath) {
		panic("badges policy requires a valid distinct successor")
	}
	return BadgesPolicy{dao: dao, successor: successor}
}
func (p BadgesPolicy) DAO() address       { return p.dao }
func (p BadgesPolicy) Successor() address { return p.successor }

type BadgesAction struct {
	kind      BadgesActionKind
	recipient address
	subject   address
}

func (p BadgesPolicy) Accept() BadgesAction { return BadgesAction{kind: BadgesAcceptOwner} }
func (p BadgesPolicy) Return() BadgesAction {
	return BadgesAction{kind: BadgesReturnOwner, recipient: p.successor}
}
func (p BadgesPolicy) AbortReturn() BadgesAction {
	return BadgesAction{kind: BadgesAbortReturn, recipient: p.successor}
}
func (p BadgesPolicy) AddAdmin(who address) BadgesAction {
	if who == p.dao || who == chain.PackageAddress(BadgesPath) {
		panic("badges admin must be an external account")
	}
	a := BadgesAction{kind: BadgesAddAdmin, subject: who}
	a.Bytes()
	return a
}
func BadgesRevokeAdmin(who address) BadgesAction {
	a := BadgesAction{kind: BadgesRemoveAdmin, subject: who}
	a.Bytes()
	return a
}
func BadgesResume() BadgesAction              { return BadgesAction{kind: BadgesUnpause} }
func (a BadgesAction) Kind() BadgesActionKind { return a.kind }
func (a BadgesAction) Recipient() address     { return a.recipient }
func (a BadgesAction) Subject() address       { return a.subject }
func (a BadgesAction) Bytes() string {
	base := "badges/v1|" + BadgesPath + "|" + string(a.kind)
	switch a.kind {
	case BadgesAcceptOwner, BadgesUnpause:
		if a.recipient != "" || a.subject != "" {
			panic("malformed badges action")
		}
		return base
	case BadgesReturnOwner, BadgesAbortReturn:
		if !a.recipient.IsValid() || a.subject != "" {
			panic("malformed badges return action")
		}
		return base + "|" + string(a.recipient)
	case BadgesAddAdmin, BadgesRemoveAdmin:
		if !a.subject.IsValid() || a.recipient != "" {
			panic("invalid badges admin action")
		}
		return base + "|" + string(a.subject)
	default:
		panic("unsupported badges action")
	}
}
func (a BadgesAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.kind == BadgesUnpause {
		return memba_weighted_policy.Financial
	}
	return memba_weighted_policy.Critical
}

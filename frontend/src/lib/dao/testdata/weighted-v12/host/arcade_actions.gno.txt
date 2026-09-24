package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const ArcadePath = "gno.land/r/samcrew/memba_arcade_leaderboard_v1"

type ArcadeActionKind string

const (
	ArcadeAcceptOwner    ArcadeActionKind = "accept-owner"
	ArcadeReturnOwner    ArcadeActionKind = "return-owner"
	ArcadeAbortReturn    ArcadeActionKind = "abort-return"
	ArcadeAddAttester    ArcadeActionKind = "add-attester"
	ArcadeRemoveAttester ArcadeActionKind = "remove-attester"
	ArcadeUnpause        ArcadeActionKind = "unpause"
)

type ArcadePolicy struct{ dao, successor address }

func NewArcadePolicy(dao, successor address) ArcadePolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("arcade policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(ArcadePath) {
		panic("arcade policy requires a valid distinct successor")
	}
	return ArcadePolicy{dao: dao, successor: successor}
}
func (p ArcadePolicy) DAO() address       { return p.dao }
func (p ArcadePolicy) Successor() address { return p.successor }

type ArcadeAction struct {
	kind      ArcadeActionKind
	recipient address
	attester  address
}

func (p ArcadePolicy) Accept() ArcadeAction { return ArcadeAction{kind: ArcadeAcceptOwner} }
func (p ArcadePolicy) Return() ArcadeAction {
	return ArcadeAction{kind: ArcadeReturnOwner, recipient: p.successor}
}
func (p ArcadePolicy) AbortReturn() ArcadeAction {
	return ArcadeAction{kind: ArcadeAbortReturn, recipient: p.successor}
}
func (p ArcadePolicy) AddAttester(who address) ArcadeAction {
	if who == p.DAO() || who == p.Successor() || who == chain.PackageAddress(ArcadePath) {
		panic("arcade attester must be a dedicated external account")
	}
	a := ArcadeAction{kind: ArcadeAddAttester, attester: who}
	a.Bytes()
	return a
}
func ArcadeRevokeAttester(who address) ArcadeAction {
	a := ArcadeAction{kind: ArcadeRemoveAttester, attester: who}
	a.Bytes()
	return a
}
func ArcadeResume() ArcadeAction              { return ArcadeAction{kind: ArcadeUnpause} }
func (a ArcadeAction) Kind() ArcadeActionKind { return a.kind }
func (a ArcadeAction) Recipient() address     { return a.recipient }
func (a ArcadeAction) Attester() address      { return a.attester }
func (a ArcadeAction) Bytes() string {
	base := "arcade/v1|" + ArcadePath + "|" + string(a.kind)
	switch a.kind {
	case ArcadeAcceptOwner, ArcadeUnpause:
		if a.recipient != "" || a.attester != "" {
			panic("malformed arcade action")
		}
		return base
	case ArcadeReturnOwner, ArcadeAbortReturn:
		if !a.recipient.IsValid() || a.attester != "" {
			panic("malformed arcade return action")
		}
		return base + "|" + string(a.recipient)
	case ArcadeAddAttester, ArcadeRemoveAttester:
		if !a.attester.IsValid() || a.recipient != "" {
			panic("invalid arcade attester action")
		}
		return base + "|" + string(a.attester)
	default:
		panic("unsupported arcade action")
	}
}
func (a ArcadeAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.kind == ArcadeUnpause {
		return memba_weighted_policy.Financial
	}
	return memba_weighted_policy.Critical
}

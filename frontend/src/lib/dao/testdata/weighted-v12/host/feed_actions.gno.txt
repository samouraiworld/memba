package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const FeedPath = "gno.land/r/samcrew/memba_feed_v1"

type FeedActionKind string

const (
	FeedAcceptOwner     FeedActionKind = "accept-owner"
	FeedReturnOwner     FeedActionKind = "return-owner"
	FeedAbortReturn     FeedActionKind = "abort-return"
	FeedAddModerator    FeedActionKind = "add-moderator"
	FeedRemoveModerator FeedActionKind = "remove-moderator"
	FeedUnpause         FeedActionKind = "unpause"
)

type FeedPolicy struct{ dao, successor address }

func NewFeedPolicy(dao, successor address) FeedPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("feed policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(FeedPath) {
		panic("feed policy requires a valid distinct successor")
	}
	return FeedPolicy{dao: dao, successor: successor}
}
func (p FeedPolicy) DAO() address       { return p.dao }
func (p FeedPolicy) Successor() address { return p.successor }

type FeedAction struct {
	kind      FeedActionKind
	recipient address
	subject   address
}

func (p FeedPolicy) Accept() FeedAction { return FeedAction{kind: FeedAcceptOwner} }
func (p FeedPolicy) Return() FeedAction {
	return FeedAction{kind: FeedReturnOwner, recipient: p.successor}
}
func (p FeedPolicy) AbortReturn() FeedAction {
	return FeedAction{kind: FeedAbortReturn, recipient: p.successor}
}
func (p FeedPolicy) AddModerator(who address) FeedAction {
	if who == p.dao || who == chain.PackageAddress(FeedPath) {
		panic("feed moderator must be an external account")
	}
	a := FeedAction{kind: FeedAddModerator, subject: who}
	a.Bytes()
	return a
}
func FeedRevokeModerator(who address) FeedAction {
	a := FeedAction{kind: FeedRemoveModerator, subject: who}
	a.Bytes()
	return a
}
func FeedResume() FeedAction              { return FeedAction{kind: FeedUnpause} }
func (a FeedAction) Kind() FeedActionKind { return a.kind }
func (a FeedAction) Recipient() address   { return a.recipient }
func (a FeedAction) Subject() address     { return a.subject }
func (a FeedAction) Bytes() string {
	base := "feed/v1|" + FeedPath + "|" + string(a.kind)
	switch a.kind {
	case FeedAcceptOwner, FeedUnpause:
		if a.recipient != "" || a.subject != "" {
			panic("malformed feed action")
		}
		return base
	case FeedReturnOwner, FeedAbortReturn:
		if !a.recipient.IsValid() || a.subject != "" {
			panic("malformed feed return action")
		}
		return base + "|" + string(a.recipient)
	case FeedAddModerator, FeedRemoveModerator:
		if !a.subject.IsValid() || a.recipient != "" {
			panic("invalid feed moderator action")
		}
		return base + "|" + string(a.subject)
	default:
		panic("unsupported feed action")
	}
}
func (a FeedAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.kind == FeedUnpause {
		return memba_weighted_policy.Financial
	}
	return memba_weighted_policy.Critical
}

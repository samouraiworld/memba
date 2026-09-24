package memba_weighted_host

import (
	"chain"
	"strconv"
	"strings"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const FeedbackPath = "gno.land/r/samcrew/memba_feedback_v2"

type FeedbackActionKind string

const (
	FeedbackAcceptOwner FeedbackActionKind = "accept-owner"
	FeedbackReturnOwner FeedbackActionKind = "return-owner"
	FeedbackAbortReturn FeedbackActionKind = "abort-return"
	FeedbackAddMember FeedbackActionKind = "add-member"
	FeedbackRemoveMember FeedbackActionKind = "remove-member"
	FeedbackSetRoles FeedbackActionKind = "set-roles"
	FeedbackCreateText FeedbackActionKind = "create-text-channel"
	FeedbackUnpause FeedbackActionKind = "unpause"
)

type FeedbackPolicy struct{ dao, successor address }

func NewFeedbackPolicy(dao, successor address) FeedbackPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("feedback policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(FeedbackPath) {
		panic("feedback policy requires a valid distinct successor")
	}
	return FeedbackPolicy{dao: dao, successor: successor}
}
func (p FeedbackPolicy) DAO() address { return p.dao }
func (p FeedbackPolicy) Successor() address { return p.successor }

type FeedbackAction struct {
	kind FeedbackActionKind
	recipient, subject address
	roles string
	name, description string
}
func (p FeedbackPolicy) Accept() FeedbackAction { return FeedbackAction{kind: FeedbackAcceptOwner} }
func (p FeedbackPolicy) Return() FeedbackAction { return FeedbackAction{kind: FeedbackReturnOwner, recipient: p.successor} }
func (p FeedbackPolicy) AbortReturn() FeedbackAction { return FeedbackAction{kind: FeedbackAbortReturn, recipient: p.successor} }
func (p FeedbackPolicy) AddMember(who address, roles string) FeedbackAction { a:=FeedbackAction{kind: FeedbackAddMember, subject:who, roles:roles}; a.Bytes(); return a }
func (p FeedbackPolicy) RemoveMember(who address) FeedbackAction { a:=FeedbackAction{kind: FeedbackRemoveMember, subject:who}; a.Bytes(); return a }
func (p FeedbackPolicy) SetRoles(who address, roles string) FeedbackAction { a:=FeedbackAction{kind: FeedbackSetRoles, subject:who, roles:roles}; a.Bytes(); return a }
func (p FeedbackPolicy) CreateText(name, description string) FeedbackAction { a:=FeedbackAction{kind: FeedbackCreateText, name:name, description:description}; a.Bytes(); return a }
func FeedbackResume() FeedbackAction { return FeedbackAction{kind: FeedbackUnpause} }
func (a FeedbackAction) Kind() FeedbackActionKind { return a.kind }
func (a FeedbackAction) Recipient() address { return a.recipient }
func (a FeedbackAction) Subject() address { return a.subject }
func (a FeedbackAction) Roles() string { return a.roles }
func (a FeedbackAction) Name() string { return a.name }
func (a FeedbackAction) Description() string { return a.description }

func validFeedbackName(name string) bool {
	if len(name)<1 || len(name)>50 { return false }
	for _,c:=range name { if !((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-') { return false } }
	return true
}
func validFeedbackDescription(description string) bool {
	if len(description)<1 || len(description)>200 { return false }
	for _,c:=range description { if c<32 || c==127 { return false } }
	return true
}

// Only the four target ACL roles are representable; every role list has a
// canonical order, so a voted commitment cannot alias another role grant.
func canonicalFeedbackRoles(roles string) bool {
	if roles == "" { return false }
	parts:=strings.Split(roles, ",")
	if len(parts)>4 { return false }
	previous:=-1
	for _,part:=range parts {
		index:=-1
		switch part { case "admin": index=0; case "dev": index=1; case "ops": index=2; case "member": index=3 }
		if index<=previous { return false }
		previous=index
	}
	return true
}
func (a FeedbackAction) Bytes() string {
	base:="feedback/v1|"+FeedbackPath+"|"+string(a.kind)
	switch a.kind {
	case FeedbackAcceptOwner, FeedbackUnpause:
		if a.recipient!="" || a.subject!="" || a.roles!="" || a.name!="" || a.description!="" { panic("malformed feedback action") }
		return base
	case FeedbackReturnOwner, FeedbackAbortReturn:
		if !a.recipient.IsValid() || a.subject!="" || a.roles!="" || a.name!="" || a.description!="" { panic("malformed feedback return action") }
		return base+"|"+string(a.recipient)
	case FeedbackAddMember, FeedbackSetRoles:
		if !a.subject.IsValid() || a.recipient!="" || a.name!="" || a.description!="" || !canonicalFeedbackRoles(a.roles) { panic("invalid feedback member action") }
		return base+"|"+string(a.subject)+"|"+strconv.Itoa(len(a.roles))+":"+a.roles
	case FeedbackRemoveMember:
		if !a.subject.IsValid() || a.recipient!="" || a.roles!="" || a.name!="" || a.description!="" { panic("invalid feedback member action") }
		return base+"|"+string(a.subject)
	case FeedbackCreateText:
		if a.recipient!="" || a.subject!="" || a.roles!="" || !validFeedbackName(a.name) || !validFeedbackDescription(a.description) { panic("invalid feedback text creation") }
		return base+"|"+a.name+"|"+strconv.Itoa(len(a.description))+":"+a.description
	default: panic("unsupported feedback action")
	}
}
func (a FeedbackAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.kind==FeedbackUnpause { return memba_weighted_policy.Financial }
	return memba_weighted_policy.Critical
}

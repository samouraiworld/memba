package memba_weighted_host

import (
	"chain"
	"strconv"
	"strings"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const ChannelsPath = "gno.land/r/samcrew/memba_dao_channels_v2"

type ChannelsActionKind string

const (
	ChannelsAcceptOwner ChannelsActionKind = "accept-owner"
	ChannelsReturnOwner ChannelsActionKind = "return-owner"
	ChannelsAbortReturn ChannelsActionKind = "abort-return"
	ChannelsAddMember ChannelsActionKind = "add-member"
	ChannelsRemoveMember ChannelsActionKind = "remove-member"
	ChannelsSetRoles ChannelsActionKind = "set-roles"
	ChannelsCreateText ChannelsActionKind = "create-text-channel"
	ChannelsUnpause ChannelsActionKind = "unpause"
)

type ChannelsPolicy struct{ dao, successor address }

func NewChannelsPolicy(dao, successor address) ChannelsPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("channels policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(ChannelsPath) {
		panic("channels policy requires a valid distinct successor")
	}
	return ChannelsPolicy{dao: dao, successor: successor}
}
func (p ChannelsPolicy) DAO() address { return p.dao }
func (p ChannelsPolicy) Successor() address { return p.successor }

type ChannelsAction struct {
	kind ChannelsActionKind
	recipient, subject address
	roles string
	name, description string
}
func (p ChannelsPolicy) Accept() ChannelsAction { return ChannelsAction{kind: ChannelsAcceptOwner} }
func (p ChannelsPolicy) Return() ChannelsAction { return ChannelsAction{kind: ChannelsReturnOwner, recipient: p.successor} }
func (p ChannelsPolicy) AbortReturn() ChannelsAction { return ChannelsAction{kind: ChannelsAbortReturn, recipient: p.successor} }
func (p ChannelsPolicy) AddMember(who address, roles string) ChannelsAction { a:=ChannelsAction{kind: ChannelsAddMember, subject:who, roles:roles}; a.Bytes(); return a }
func (p ChannelsPolicy) RemoveMember(who address) ChannelsAction { a:=ChannelsAction{kind: ChannelsRemoveMember, subject:who}; a.Bytes(); return a }
func (p ChannelsPolicy) SetRoles(who address, roles string) ChannelsAction { a:=ChannelsAction{kind: ChannelsSetRoles, subject:who, roles:roles}; a.Bytes(); return a }
func (p ChannelsPolicy) CreateText(name, description string) ChannelsAction { a:=ChannelsAction{kind: ChannelsCreateText, name:name, description:description}; a.Bytes(); return a }
func ChannelsResume() ChannelsAction { return ChannelsAction{kind: ChannelsUnpause} }
func (a ChannelsAction) Kind() ChannelsActionKind { return a.kind }
func (a ChannelsAction) Recipient() address { return a.recipient }
func (a ChannelsAction) Subject() address { return a.subject }
func (a ChannelsAction) Roles() string { return a.roles }
func (a ChannelsAction) Name() string { return a.name }
func (a ChannelsAction) Description() string { return a.description }

func validChannelsName(name string) bool {
	if len(name)<1 || len(name)>50 { return false }
	for _,c:=range name { if !((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-') { return false } }
	return true
}
func validChannelsDescription(description string) bool {
	if len(description)<1 || len(description)>200 { return false }
	for _,c:=range description { if c<32 || c==127 { return false } }
	return true
}

// Only the four target ACL roles are representable; every role list has a
// canonical order, so a voted commitment cannot alias another role grant.
func canonicalChannelsRoles(roles string) bool {
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
func (a ChannelsAction) Bytes() string {
	base:="channels/v1|"+ChannelsPath+"|"+string(a.kind)
	switch a.kind {
	case ChannelsAcceptOwner, ChannelsUnpause:
		if a.recipient!="" || a.subject!="" || a.roles!="" || a.name!="" || a.description!="" { panic("malformed channels action") }
		return base
	case ChannelsReturnOwner, ChannelsAbortReturn:
		if !a.recipient.IsValid() || a.subject!="" || a.roles!="" || a.name!="" || a.description!="" { panic("malformed channels return action") }
		return base+"|"+string(a.recipient)
	case ChannelsAddMember, ChannelsSetRoles:
		if !a.subject.IsValid() || a.recipient!="" || a.name!="" || a.description!="" || !canonicalChannelsRoles(a.roles) { panic("invalid channels member action") }
		return base+"|"+string(a.subject)+"|"+strconv.Itoa(len(a.roles))+":"+a.roles
	case ChannelsRemoveMember:
		if !a.subject.IsValid() || a.recipient!="" || a.roles!="" || a.name!="" || a.description!="" { panic("invalid channels member action") }
		return base+"|"+string(a.subject)
	case ChannelsCreateText:
		if a.recipient!="" || a.subject!="" || a.roles!="" || !validChannelsName(a.name) || !validChannelsDescription(a.description) { panic("invalid channels text creation") }
		return base+"|"+a.name+"|"+strconv.Itoa(len(a.description))+":"+a.description
	default: panic("unsupported channels action")
	}
}
func (a ChannelsAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.kind==ChannelsUnpause { return memba_weighted_policy.Financial }
	return memba_weighted_policy.Critical
}

package memba_weighted_host

import (
	"chain"
	"encoding/hex"
	"gno.land/p/samcrew/memba_weighted_policy"
)

const QuestPath = "gno.land/r/samcrew/memba_quest_attestation_v1"

type QuestActionKind string

const (
	QuestAcceptOwner QuestActionKind = "accept-owner"
	QuestSetSigner   QuestActionKind = "set-signer"
	QuestReturnOwner QuestActionKind = "return-owner"
	QuestAbortReturn QuestActionKind = "abort-return"
)

type QuestPolicy struct{ dao, successor address }

func NewQuestPolicy(dao, successor address) QuestPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("quest policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(QuestPath) {
		panic("quest policy requires a valid distinct successor")
	}
	return QuestPolicy{dao: dao, successor: successor}
}
func (p QuestPolicy) DAO() address       { return p.dao }
func (p QuestPolicy) Successor() address { return p.successor }

type QuestAction struct {
	kind      QuestActionKind
	key       string
	recipient address
}

func (p QuestPolicy) Accept() QuestAction { return QuestAction{kind: QuestAcceptOwner} }
func (p QuestPolicy) Return() QuestAction {
	return QuestAction{kind: QuestReturnOwner, recipient: p.successor}
}
func (p QuestPolicy) AbortReturn() QuestAction {
	return QuestAction{kind: QuestAbortReturn, recipient: p.successor}
}
func QuestSigner(key string) QuestAction {
	a := QuestAction{kind: QuestSetSigner, key: key}
	a.Bytes()
	return a
}
func (a QuestAction) Kind() QuestActionKind { return a.kind }
func (a QuestAction) Key() string           { return a.key }
func (a QuestAction) Recipient() address    { return a.recipient }
func canonicalQuestKey(key string) bool {
	if len(key) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(key)
	return err == nil && len(decoded) == 32 && hex.EncodeToString(decoded) == key
}
func (a QuestAction) Bytes() string {
	base := "quest/v1|" + QuestPath + "|" + string(a.kind)
	switch a.kind {
	case QuestAcceptOwner:
		if a.key != "" || a.recipient != "" {
			panic("malformed quest accept action")
		}
		return base
	case QuestSetSigner:
		if !canonicalQuestKey(a.key) || a.recipient != "" {
			panic("quest signer requires canonical 32-byte hex")
		}
		return base + "|" + a.key
	case QuestReturnOwner, QuestAbortReturn:
		if a.key != "" || !a.recipient.IsValid() {
			panic("malformed quest return action")
		}
		return base + "|" + string(a.recipient)
	default:
		panic("unsupported quest action")
	}
}
func (a QuestAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	// Replacing the voucher-issuing key transfers attestation authority.
	// It cannot be disguised as a routine content change.
	return memba_weighted_policy.Critical
}

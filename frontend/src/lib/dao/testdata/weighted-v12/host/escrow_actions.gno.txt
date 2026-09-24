package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
	"strconv"
)

const EscrowPath = "gno.land/r/samcrew/escrow_v4"

type EscrowActionKind string

const (
	EscrowAcceptOwner   EscrowActionKind = "accept-owner"
	EscrowReturnOwner   EscrowActionKind = "return-owner"
	EscrowAbortReturn   EscrowActionKind = "abort-return"
	EscrowUnpause       EscrowActionKind = "unpause"
	EscrowRefundClient  EscrowActionKind = "refund-client"
	EscrowPayFreelancer EscrowActionKind = "pay-freelancer"
	// EscrowSetFeeRecipient stages a new fallback fee recipient (escrow_v4
	// two-step rotation); the staged address accepts with its own transaction.
	EscrowSetFeeRecipient EscrowActionKind = "set-fee-recipient"
)

type EscrowPolicy struct{ dao, successor address }

func NewEscrowPolicy(dao, successor address) EscrowPolicy {
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("escrow policy requires the founding DAO address")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(EscrowPath) {
		panic("escrow policy requires a valid distinct successor")
	}
	return EscrowPolicy{dao: dao, successor: successor}
}
func (p EscrowPolicy) DAO() address       { return p.dao }
func (p EscrowPolicy) Successor() address { return p.successor }

type EscrowAction struct {
	kind       EscrowActionKind
	recipient  address
	contractID string
	milestone  int
}

func (p EscrowPolicy) Accept() EscrowAction { return EscrowAction{kind: EscrowAcceptOwner} }
func (p EscrowPolicy) Return() EscrowAction {
	return EscrowAction{kind: EscrowReturnOwner, recipient: p.successor}
}
func (p EscrowPolicy) AbortReturn() EscrowAction {
	return EscrowAction{kind: EscrowAbortReturn, recipient: p.successor}
}
func EscrowResume() EscrowAction { return EscrowAction{kind: EscrowUnpause} }
func EscrowFeeRecipient(recipient address) EscrowAction {
	a := EscrowAction{kind: EscrowSetFeeRecipient, recipient: recipient}
	a.Bytes()
	return a
}
func EscrowResolution(id string, index int, refund bool) EscrowAction {
	kind := EscrowPayFreelancer
	if refund {
		kind = EscrowRefundClient
	}
	a := EscrowAction{kind: kind, contractID: id, milestone: index}
	a.Bytes()
	return a
}
func (a EscrowAction) Kind() EscrowActionKind { return a.kind }
func (a EscrowAction) Recipient() address     { return a.recipient }
func (a EscrowAction) ContractID() string     { return a.contractID }
func (a EscrowAction) Milestone() int         { return a.milestone }
func (a EscrowAction) IsResolution() bool {
	return a.kind == EscrowRefundClient || a.kind == EscrowPayFreelancer
}
func (a EscrowAction) Bytes() string {
	base := "escrow/v1|" + EscrowPath + "|" + string(a.kind)
	if a.IsResolution() {
		n, err := strconv.ParseUint(a.contractID, 10, 64)
		if err != nil || strconv.FormatUint(n, 10) != a.contractID || a.milestone < 0 || a.milestone >= 20 || a.recipient != "" {
			panic("invalid escrow resolution action")
		}
		return base + "|" + a.contractID + "|" + strconv.Itoa(a.milestone)
	}
	if a.contractID != "" || a.milestone != 0 {
		panic("malformed escrow action")
	}
	switch a.kind {
	case EscrowAcceptOwner, EscrowUnpause:
		if a.recipient != "" {
			panic("malformed escrow action")
		}
		return base
	case EscrowReturnOwner, EscrowAbortReturn:
		if !a.recipient.IsValid() {
			panic("invalid escrow return action")
		}
		return base + "|" + string(a.recipient)
	case EscrowSetFeeRecipient:
		if !a.recipient.IsValid() {
			panic("invalid escrow fee recipient action")
		}
		return base + "|" + string(a.recipient)
	default:
		panic("unsupported escrow action")
	}
}
func (a EscrowAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.IsResolution() || a.kind == EscrowUnpause || a.kind == EscrowSetFeeRecipient {
		return memba_weighted_policy.Financial
	}
	return memba_weighted_policy.Critical
}

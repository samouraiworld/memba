package memba_weighted_host

import (
	"strconv"

	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
)

// MarketConfigPath is the sole target of this source-only typed action model.
// These values do not dispatch an action or grant the host application authority.
const MarketConfigPath = "gno.land/r/samcrew/memba_market_config"

type MarketLane string

const (
	MarketNFT     MarketLane = "nft"
	MarketService MarketLane = "service"
	MarketToken   MarketLane = "token"
)

type MarketActionKind string

const (
	MarketAcceptAdmin  MarketActionKind = "accept-admin"
	MarketSetFee       MarketActionKind = "set-fee"
	MarketSetTreasury  MarketActionKind = "set-treasury"
	MarketReturnAdmin  MarketActionKind = "return-admin"
	MarketAbortReturn MarketActionKind = "abort-return"
)

// MarketPolicy contains only addresses separately approved for a generated DAO
// candidate. The generator requires explicit inputs and binds fixed-target
// dispatch. No address here is inferred from an old testnet literal.
type MarketPolicy struct {
	dao       address
	treasury  address
	successor address
}

func NewMarketPolicy(dao, treasury, successor address) MarketPolicy {
	target := chain.PackageAddress(MarketConfigPath)
	if !dao.IsValid() || dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("market policy requires the founding DAO address")
	}
	if !treasury.IsValid() || treasury == target || treasury == dao {
		panic("market policy requires a valid external treasury")
	}
	if !successor.IsValid() || successor == dao || successor == target {
		panic("market policy requires a valid distinct successor")
	}
	return MarketPolicy{dao: dao, treasury: treasury, successor: successor}
}

func (p MarketPolicy) DAO() address       { return p.dao }
func (p MarketPolicy) Treasury() address  { return p.treasury }
func (p MarketPolicy) Successor() address { return p.successor }

// MarketAction is a closed value, not a callback, method name or free-form
// payload. Its private fields are frozen into the commitment returned by Bytes.
type MarketAction struct {
	kind      MarketActionKind
	lane      MarketLane
	bps       int64
	recipient address
}

func MarketAccept() MarketAction { return MarketAction{kind: MarketAcceptAdmin} }

func MarketFee(lane MarketLane, bps int64) MarketAction {
	if lane != MarketNFT && lane != MarketService && lane != MarketToken {
		panic("unsupported market fee lane")
	}
	if bps < 0 || bps > 500 {
		panic("market fee out of range")
	}
	return MarketAction{kind: MarketSetFee, lane: lane, bps: bps}
}

func (p MarketPolicy) SetTreasury() MarketAction {
	return MarketAction{kind: MarketSetTreasury, recipient: p.treasury}
}

func (p MarketPolicy) ReturnAdmin() MarketAction {
	return MarketAction{kind: MarketReturnAdmin, recipient: p.successor}
}

func (p MarketPolicy) AbortReturn() MarketAction {
	return MarketAction{kind: MarketAbortReturn, recipient: p.successor}
}

func (a MarketAction) Kind() MarketActionKind { return a.kind }
func (a MarketAction) Lane() MarketLane       { return a.lane }
func (a MarketAction) BPS() int64             { return a.bps }
func (a MarketAction) Recipient() address     { return a.recipient }

func (a MarketAction) Category() memba_weighted_policy.Category {
	// Refuse zero-value or malformed actions before returning an authorization
	// category, including values created from a zero-value MarketPolicy.
	a.Bytes()
	switch a.kind {
	case MarketSetFee, MarketSetTreasury:
		return memba_weighted_policy.Financial
	case MarketAcceptAdmin, MarketReturnAdmin, MarketAbortReturn:
		return memba_weighted_policy.Critical
	default:
		panic("unsupported market action")
	}
}

// Bytes commits the target path, operation, category-relevant arguments and
// recipient. There are no user-supplied delimiters in these closed domains.
func (a MarketAction) Bytes() string {
	base := "market-config/v1|" + MarketConfigPath + "|" + string(a.kind)
	switch a.kind {
	case MarketAcceptAdmin:
		if a.lane != "" || a.bps != 0 || a.recipient != "" {
			panic("malformed market accept action")
		}
		return base
	case MarketSetFee:
		if (a.lane != MarketNFT && a.lane != MarketService && a.lane != MarketToken) || a.bps < 0 || a.bps > 500 || a.recipient != "" {
			panic("malformed market fee action")
		}
		return base + "|" + string(a.lane) + "|" + strconv.FormatInt(a.bps, 10)
	case MarketSetTreasury, MarketReturnAdmin, MarketAbortReturn:
		if a.lane != "" || a.bps != 0 || !a.recipient.IsValid() {
			panic("malformed market recipient action")
		}
		return base + "|" + string(a.recipient)
	default:
		panic("unsupported market action")
	}
}

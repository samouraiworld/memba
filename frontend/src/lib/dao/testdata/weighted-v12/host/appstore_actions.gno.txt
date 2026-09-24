package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
	"strconv"
	"strings"
)

const AppstorePath = "gno.land/r/samcrew/memba_appstore_v3"
const AppstoreMaxFee = int64(100000000)

type AppstoreKind string

const (
	AppstoreAccept        AppstoreKind = "accept-owner"
	AppstoreReturn        AppstoreKind = "return-owner"
	AppstoreAbortReturn   AppstoreKind = "abort-return"
	AppstoreAddCurator    AppstoreKind = "add-curator"
	AppstoreRemoveCurator AppstoreKind = "remove-curator"
	AppstoreFee           AppstoreKind = "set-fee"
	AppstoreTreasury      AppstoreKind = "set-treasury"
	AppstoreUnpause       AppstoreKind = "unpause"
	AppstoreSeal          AppstoreKind = "seal-import"
	AppstoreApprove       AppstoreKind = "approve"
	AppstoreReject        AppstoreKind = "reject"
	AppstoreDelist        AppstoreKind = "delist"
	AppstoreRestore       AppstoreKind = "restore"
	AppstoreClearFlags    AppstoreKind = "clear-flags"
)

type AppstorePolicy struct{ dao, successor, treasury address }

func NewAppstorePolicy(dao, successor, treasury address) AppstorePolicy {
	if dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("appstore policy requires the founding DAO address")
	}
	for _, a := range []address{successor, treasury} {
		if !a.IsValid() || a == dao || a == chain.PackageAddress(AppstorePath) {
			panic("appstore destination must be valid and distinct from DAO and target")
		}
	}
	return AppstorePolicy{dao, successor, treasury}
}
func (p AppstorePolicy) DAO() address       { return p.dao }
func (p AppstorePolicy) Successor() address { return p.successor }
func (p AppstorePolicy) Treasury() address  { return p.treasury }

type AppstoreAction struct {
	kind         AppstoreKind
	recipient    address
	fee          int64
	path, reason string
}

func (p AppstorePolicy) Accept() AppstoreAction { return AppstoreAction{kind: AppstoreAccept} }
func (p AppstorePolicy) Return() AppstoreAction {
	return AppstoreAction{kind: AppstoreReturn, recipient: p.successor}
}
func (p AppstorePolicy) AbortReturn() AppstoreAction {
	return AppstoreAction{kind: AppstoreAbortReturn, recipient: p.successor}
}
func (p AppstorePolicy) SetTreasury() AppstoreAction {
	return AppstoreAction{kind: AppstoreTreasury, recipient: p.treasury}
}
func AppstoreCurator(who address, grant bool) AppstoreAction {
	k := AppstoreRemoveCurator
	if grant {
		k = AppstoreAddCurator
	}
	a := AppstoreAction{kind: k, recipient: who}
	a.Bytes()
	return a
}
func AppstoreRegistrationFee(fee int64) AppstoreAction {
	a := AppstoreAction{kind: AppstoreFee, fee: fee}
	a.Bytes()
	return a
}
func AppstoreResume() AppstoreAction     { return AppstoreAction{kind: AppstoreUnpause} }
func AppstoreSealImport() AppstoreAction { return AppstoreAction{kind: AppstoreSeal} }
func AppstoreModeration(kind AppstoreKind, path, reason string) AppstoreAction {
	a := AppstoreAction{kind: kind, path: path, reason: reason}
	if !a.IsListing() {
		panic("unsupported appstore moderation")
	}
	a.Bytes()
	return a
}
func (a AppstoreAction) Kind() AppstoreKind { return a.kind }
func (a AppstoreAction) Recipient() address { return a.recipient }
func (a AppstoreAction) Fee() int64         { return a.fee }
func (a AppstoreAction) Path() string       { return a.path }
func (a AppstoreAction) Reason() string     { return a.reason }
func (a AppstoreAction) IsListing() bool {
	return a.kind == AppstoreApprove || a.kind == AppstoreReject || a.kind == AppstoreDelist || a.kind == AppstoreRestore || a.kind == AppstoreClearFlags
}
func (a AppstoreAction) Bytes() string {
	if a.IsListing() {
		if a.recipient != "" || a.fee != 0 || len(a.path) > 200 || !(strings.HasPrefix(a.path, "gno.land/r/") || strings.HasPrefix(a.path, "gno.land/p/")) || len(a.reason) > 500 || (a.kind != AppstoreReject && a.reason != "") {
			panic("invalid appstore moderation")
		}
	} else {
		if a.path != "" || a.reason != "" {
			panic("malformed appstore action")
		}
		switch a.kind {
		case AppstoreAccept, AppstoreUnpause, AppstoreSeal:
			if a.recipient != "" || a.fee != 0 {
				panic("malformed appstore action")
			}
		case AppstoreReturn, AppstoreAbortReturn, AppstoreTreasury, AppstoreAddCurator, AppstoreRemoveCurator:
			if !a.recipient.IsValid() || a.fee != 0 {
				panic("invalid appstore recipient")
			}
		case AppstoreFee:
			if a.recipient != "" || a.fee < 0 || a.fee > AppstoreMaxFee {
				panic("invalid appstore fee")
			}
		default:
			panic("unsupported appstore action")
		}
	}
	return "appstore/v1|" + AppstorePath + "|" + quoteJSON(string(a.kind)) + "|" + quoteJSON(string(a.recipient)) + "|" + strconv.FormatInt(a.fee, 10) + "|" + quoteJSON(a.path) + "|" + quoteJSON(a.reason)
}
func (a AppstoreAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	if a.IsListing() {
		return memba_weighted_policy.Routine
	}
	switch a.kind {
	case AppstoreFee, AppstoreTreasury, AppstoreUnpause:
		return memba_weighted_policy.Financial
	}
	return memba_weighted_policy.Critical
}

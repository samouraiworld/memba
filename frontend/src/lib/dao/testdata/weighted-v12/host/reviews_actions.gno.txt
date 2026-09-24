package memba_weighted_host

import (
	"chain"
	"gno.land/p/samcrew/memba_weighted_policy"
	"strconv"
)

const ReviewsV1Path = "gno.land/r/samcrew/memba_reviews_v1"
const ReviewsV2Path = "gno.land/r/samcrew/memba_reviews_v2"

type ReviewsPolicy struct {
	dao       address
	target    string
	successor address
}

func NewReviewsPolicy(dao address, target string, successor address) ReviewsPolicy {
	if dao != chain.PackageAddress("gno.land/r/samcrew/memba_dao") {
		panic("reviews policy requires the founding DAO address")
	}
	if target != ReviewsV1Path && target != ReviewsV2Path {
		panic("unsupported reviews target")
	}
	if !successor.IsValid() || successor == dao || successor == chain.PackageAddress(target) {
		panic("reviews policy requires a valid distinct successor")
	}
	return ReviewsPolicy{dao: dao, target: target, successor: successor}
}
func (p ReviewsPolicy) DAO() address       { return p.dao }
func (p ReviewsPolicy) Target() string     { return p.target }
func (p ReviewsPolicy) Successor() address { return p.successor }

type ReviewsActionKind string

const (
	ReviewsAcceptModerator ReviewsActionKind = "accept-moderator"
	ReviewsReturnModerator ReviewsActionKind = "return-moderator"
	ReviewsAbortReturn     ReviewsActionKind = "abort-return"
	ReviewsHideReview      ReviewsActionKind = "hide-review"
	ReviewsHideComment     ReviewsActionKind = "hide-comment"
	ReviewsUnhide          ReviewsActionKind = "unhide"
)

type ReviewsAction struct {
	kind      ReviewsActionKind
	target    string
	id        uint64
	recipient address
}

func (p ReviewsPolicy) Accept() ReviewsAction {
	return ReviewsAction{kind: ReviewsAcceptModerator, target: p.target}
}
func (p ReviewsPolicy) Return() ReviewsAction {
	return ReviewsAction{kind: ReviewsReturnModerator, target: p.target, recipient: p.successor}
}
func (p ReviewsPolicy) AbortReturn() ReviewsAction {
	return ReviewsAction{kind: ReviewsAbortReturn, target: p.target, recipient: p.successor}
}
func (p ReviewsPolicy) HideReview(id uint64) ReviewsAction {
	return p.itemAction(ReviewsHideReview, id)
}
func (p ReviewsPolicy) HideComment(id uint64) ReviewsAction {
	return p.itemAction(ReviewsHideComment, id)
}
func (p ReviewsPolicy) Unhide(id uint64) ReviewsAction { return p.itemAction(ReviewsUnhide, id) }
func (p ReviewsPolicy) itemAction(kind ReviewsActionKind, id uint64) ReviewsAction {
	if id == 0 {
		panic("reviews item ID must be positive")
	}
	return ReviewsAction{kind: kind, target: p.target, id: id}
}
func (a ReviewsAction) Kind() ReviewsActionKind { return a.kind }
func (a ReviewsAction) Target() string          { return a.target }
func (a ReviewsAction) ID() uint64              { return a.id }
func (a ReviewsAction) Recipient() address      { return a.recipient }
func (a ReviewsAction) Category() memba_weighted_policy.Category {
	a.Bytes()
	switch a.kind {
	case ReviewsHideReview, ReviewsHideComment, ReviewsUnhide:
		return memba_weighted_policy.Routine
	default:
		return memba_weighted_policy.Critical
	}
}
func (a ReviewsAction) Bytes() string {
	if a.target != ReviewsV1Path && a.target != ReviewsV2Path {
		panic("unsupported reviews target")
	}
	switch a.kind {
	case ReviewsAcceptModerator:
		if a.id != 0 || a.recipient != "" {
			panic("malformed reviews authority action")
		}
	case ReviewsReturnModerator, ReviewsAbortReturn:
		if a.id != 0 || !a.recipient.IsValid() {
			panic("malformed reviews authority action")
		}
	case ReviewsHideReview, ReviewsHideComment, ReviewsUnhide:
		if a.id == 0 || a.recipient != "" {
			panic("malformed reviews item action")
		}
	default:
		panic("unsupported reviews action")
	}
	return "reviews/v1|" + a.target + "|" + string(a.kind) + "|" + strconv.FormatUint(a.id, 10) + "|" + string(a.recipient)
}

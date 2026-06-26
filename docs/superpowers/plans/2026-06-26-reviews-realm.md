# Memba Reviews / Web-of-Trust Realm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an open, on-chain rating + review system (web-of-trust) for any Memba profile subject (validators, candidates, individuals, orgs/DAOs), wired into the profile pages behind a feature flag.

**Architecture:** A new gno 0.9 realm `gno.land/r/samcrew/memba_reviews_v1` (lives in the **samcrew-deployer** repo, NOT Memba — gno paths are immutable so the path is versioned) holds all state: one editable review per `(author, subject)`, flat one-level comments, like/dislike reactions, a running O(1) net-likes **reputation** counter per author, community `Flag` + multisig `Hide` moderation. The **Memba** frontend reads via RPC `qeval` (paginated JSON-returning funcs) and writes user-signed txs via Adena (`MsgCall`), joining each author to their `r/sys/users` verified `@username`. No new backend in v1.

**Tech Stack:** gno 0.9 (`chain`, `chain/runtime`, `chain/runtime/unsafe`, `gno.land/p/nt/avl/v0`, `gno.land/p/nt/ufmt/v0`); gno tests (`testing.SetRealm`, `gno.land/p/nt/testutils/v0`, `gno.land/p/nt/uassert/v0`); React/TypeScript + Vite (Memba frontend); Adena wallet; samcrew-deployer (`gnokey maketx addpkg`, multisig).

## Global Constraints

- **Two repos.** Realm + gno tests + deploy = **samcrew-deployer** (`/Users/zxxma/Desktop/Code/Gno/samcrew-deployer`, realms under `projects/memba/realms/`). Frontend = **Memba** (`/Users/zxxma/Desktop/Code/Gno/Memba/frontend`). Each task header states its repo.
- **gno version = `0.9`** in `gnomod.toml` (`module = "..."` + `gno = "0.9"`). NOT `gno.mod`.
- **gno 0.9 std API surface (VERIFIED in this codebase — the spec's `std.PreviousRealm()` pseudocode is OUTDATED):** caller = `unsafe.PreviousRealm().Address()` (import `chain/runtime/unsafe`); init-time deployer = `unsafe.OriginCaller()`; block height = `runtime.ChainHeight()` (import `chain/runtime`) — used as the timestamp basis everywhere in this codebase (there is no on-chain wall-clock used by Memba realms); events = `chain.Emit(name, k, v, ...)`; write functions take a leading `cur realm` param; tests call them with the `cross` keyword.
- **Moderator multisig** = `const ModeratorAddress = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"` — the samcrew-core-test1 multisig used as owner/admin by `agent_registry` and `memba_dao_candidature_v2` on testnet. **CONFIRM with the user this is the intended Memba moderator multisig before deploy (Task 9).**
- **Immutable path → versioned:** package path is `gno.land/r/samcrew/memba_reviews_v1`. A redeploy with changed code requires `_v2`.
- **Mandatory security review (Task 8) BEFORE any deploy (Task 9)** — hard gate, user requirement. No on-chain code reaches test13 until the Samourai Gno Security Guard analyzer + a manual pass run clean.
- **Feature flag `VITE_ENABLE_REVIEWS`** (default OFF) gates the entire frontend feature. It MUST be added to `SAFETY_GATED_FLAGS` in `frontend/src/lib/safeFlags.ts` (it gates on-chain enforcement that is incomplete until the realm is live + reviewed). `.env.example` keeps it `false`. The build-time `assertSafeFlags` gate FAILS a production Netlify build if it is `"true"` in prod env — only flip on (Task 15) after deploy + review + user approval.
- **Git (BOTH repos):** never commit on `main`/`master`; branch (`feat/...`) + PR. **No Claude attribution** in commits/PRs (no `Co-Authored-By`, no "Generated with" footer). Ask before pushing / opening a PR. Never merge without explicit user approval.
- **Light-theme guardrail (Memba):** `ci.yml` fails any new hardcoded `color:` hex/hsl/rgb in component CSS. New review CSS must use `--color-k-*-text` tokens or the `.k-brand-text` utility (+ `--ck`). 0 new light-mode offenders is a DoD item.
- **DRY · YAGNI · TDD · frequent commits.** gno tests: `cd projects/memba/realms/memba_reviews_v1 && gno test .` (or the repo's test target). Frontend tests: `cd frontend && npm test`.

## Locked sub-decisions (spec §10, resolved for this plan)

- Review body cap = **2000** chars; comment body cap = **1000** chars; reject empty/over-cap with a panic.
- Delete = **tombstone** (keep ID + slot, set `Deleted=true`, clear `Body`) so comment threads + reaction history stay coherent and reputation isn't reset by delete/re-post churn.
- Comments **do** count toward reputation (reactions on a comment move the comment author's reputation).
- One global monotonic ID space (`nextID`) shared by reviews AND comments → a `React`/`Flag` `targetID` is unambiguous.

## File structure

**samcrew-deployer** (realm):
- `projects/memba/realms/memba_reviews_v1/gnomod.toml` — module + gno version.
- `projects/memba/realms/memba_reviews_v1/memba_reviews_v1.gno` — the realm: constants, types, state, `init`, write funcs, read/JSON funcs, `Render`, helpers (`sanitizeForRender`, `jsonEscape`, auth asserts).
- `projects/memba/realms/memba_reviews_v1/memba_reviews_v1_test.gno` — model/read/render unit tests.
- `projects/memba/realms/memba_reviews_v1/memba_reviews_v1_acl_test.gno` — auth/reputation/moderation ACL tests.
- `projects/memba/deploy.sh` — MODIFY: add a deploy block for the realm.

**Memba** (frontend):
- `frontend/src/lib/reviews.ts` — CREATE: types, RPC `qeval` JSON reads + unwrap helper, Adena write builders, reputation/username join.
- `frontend/src/lib/reviews.test.ts` — CREATE: pure parser/unwrap/sort tests.
- `frontend/src/lib/config.ts` — MODIFY: `reviewsPath`, allowlist, `isReviewsEnabled`/`isReviewsValid`.
- `frontend/src/lib/safeFlags.ts` — MODIFY: add `VITE_ENABLE_REVIEWS` to `SAFETY_GATED_FLAGS`.
- `frontend/src/components/reviews/ReviewsSection.tsx` — CREATE: the section (summary, list, write form, connect-gate).
- `frontend/src/components/reviews/ReviewCard.tsx` — CREATE: one review (stars, body, author+badge+reputation, react/reply/flag, author edit/delete, multisig hide).
- `frontend/src/components/reviews/StarRating.tsx` — CREATE: read + input star control.
- `frontend/src/components/reviews/reviews.css` — CREATE: styles (tokens only).
- `frontend/.env.example` — MODIFY: `VITE_ENABLE_REVIEWS=false`.
- `frontend/src/pages/ProfilePage.tsx` + `frontend/src/pages/ValoperDetail.tsx` — MODIFY: render `<ReviewsSection subject={...} />` behind the flag. (NOTE: there is **no** existing "launching soon" placeholder to replace — these are new additions. The spec's "ValidatorProfile.tsx" = the actual `ValoperDetail.tsx`.)

---

## Task 1: Realm scaffold — package, types, state, init, helpers (samcrew-deployer)

**Files:**
- Create: `projects/memba/realms/memba_reviews_v1/gnomod.toml`
- Create: `projects/memba/realms/memba_reviews_v1/memba_reviews_v1.gno`
- Test: `projects/memba/realms/memba_reviews_v1/memba_reviews_v1_test.gno`

**Interfaces:**
- Produces: the `Review`/`Comment` structs, all `*avl.Tree` state vars, `init()`, `nextID` counter, and helpers `sanitizeForRender(string) string`, `jsonEscape(string) string`, `assertModerator()`, `getReview(id)`, `getComment(id)`. Later tasks add exported funcs to this same file.

- [ ] **Step 1: Write `gnomod.toml`**

```toml
module = "gno.land/r/samcrew/memba_reviews_v1"
gno = "0.9"
```

- [ ] **Step 2: Write the failing scaffold test**

`memba_reviews_v1_test.gno`:

```gno
package memba_reviews_v1

import "testing"

func TestInit(t *testing.T) {
	if reviews == nil || comments == nil || subjectIndex == nil ||
		authorSubject == nil || reactions == nil || flags == nil || reputation == nil {
		t.Fatal("state trees not initialized")
	}
	if nextID != 1 {
		t.Fatalf("nextID should start at 1, got %d", nextID)
	}
}
```

- [ ] **Step 3: Run it — expect FAIL (undefined symbols)**

Run: `cd projects/memba/realms/memba_reviews_v1 && gno test .`
Expected: build/compile failure — `reviews` etc. undefined.

- [ ] **Step 4: Write the scaffold in `memba_reviews_v1.gno`**

```gno
package memba_reviews_v1

// Memba Reviews / Web-of-Trust realm.
//
// OPEN, on-chain ratings + reviews for any Memba subject (validator/candidate/
// individual address, or an org/DAO realm path). Anyone with a wallet may post
// ONE editable review per subject, react (like/dislike), reply (flat, one
// level), and flag. A running net-likes reputation counter per author drives
// ranking. Moderation = author delete (tombstone) + community flag + multisig
// hide (soft-delete). Text is permanent on-chain; Hide only omits from reads.
//
// Reads: exported *JSON funcs queried via RPC vm/qeval (paginated). Render() is
// a secondary human view for gnoweb.

import (
	"chain"
	"chain/runtime"
	"chain/runtime/unsafe"
	"strconv"
	"strings"

	"gno.land/p/nt/avl/v0"
	"gno.land/p/nt/ufmt/v0"
)

// ── Constants ────────────────────────────────────────────────
const (
	MaxBodyLen    = 2000 // review body
	MaxCommentLen = 1000 // comment body
	MaxPageLimit  = 100  // hard cap on any paginated read (DoS guard)
	FlagThreshold = 5    // community flags before auto-hide

	// Memba moderator multisig (samcrew-core-test1 on testnet). CONFIRM before deploy.
	ModeratorAddress = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
)

// ── Types ────────────────────────────────────────────────────
type Review struct {
	ID        uint64
	Subject   string  // g1… address OR realm path
	Author    address
	Rating    int     // 1..5
	Body      string  // optional, ≤ MaxBodyLen
	CreatedAt int64   // block height
	EditedAt  int64   // block height of last edit (0 if never)
	Hidden    bool    // multisig soft-delete / auto-hide
	Deleted   bool    // author tombstone
	Likes     uint64
	Dislikes  uint64
	FlagCount uint64
}

type Comment struct {
	ID        uint64
	ReviewID  uint64
	Author    address
	Body      string // ≤ MaxCommentLen
	CreatedAt int64
	EditedAt  int64
	Hidden    bool
	Deleted   bool
	Likes     uint64
	Dislikes  uint64
	FlagCount uint64
}

// ── State ────────────────────────────────────────────────────
var (
	reviews       *avl.Tree // strID(id) -> *Review
	comments      *avl.Tree // strID(id) -> *Comment
	subjectIndex  *avl.Tree // subject -> []uint64 (review IDs, ascending) — bounds reads
	commentIndex  *avl.Tree // strID(reviewID) -> []uint64 (comment IDs, ascending)
	authorSubject *avl.Tree // subject + "\x00" + author -> uint64 (reviewID) — one-per-pair
	reactions     *avl.Tree // strID(targetID) + "/" + addr -> "like"|"dislike"
	flags         *avl.Tree // strID(targetID) + "/" + addr -> true (one flag per acct/target)
	reputation    *avl.Tree // addr -> int64 (Σ likes−dislikes on their reviews+comments)
	flaggedIDs    *avl.Tree // strID(targetID) -> true (visible targets with ≥1 flag, for the mod dashboard)
	nextID        uint64
)

func init() {
	reviews = avl.NewTree()
	comments = avl.NewTree()
	subjectIndex = avl.NewTree()
	commentIndex = avl.NewTree()
	authorSubject = avl.NewTree()
	reactions = avl.NewTree()
	flags = avl.NewTree()
	reputation = avl.NewTree()
	flaggedIDs = avl.NewTree()
	nextID = 1
}

// ── Helpers ──────────────────────────────────────────────────
func strID(id uint64) string { return strconv.FormatUint(id, 10) }

func getReview(id uint64) (*Review, bool) {
	v, ok := reviews.Get(strID(id))
	if !ok {
		return nil, false
	}
	return v.(*Review), true
}

func getComment(id uint64) (*Comment, bool) {
	v, ok := comments.Get(strID(id))
	if !ok {
		return nil, false
	}
	return v.(*Comment), true
}

func assertModerator() {
	caller := unsafe.PreviousRealm().Address()
	if caller != address(ModeratorAddress) {
		panic("unauthorized: moderator multisig only")
	}
}

func getReputation(addr string) int64 {
	if v, ok := reputation.Get(addr); ok {
		return v.(int64)
	}
	return 0
}

func addReputation(addr string, delta int64) {
	reputation.Set(addr, getReputation(addr)+delta)
}

func idList(t *avl.Tree, key string) []uint64 {
	if v, ok := t.Get(key); ok {
		return v.([]uint64)
	}
	return nil
}

// sanitizeForRender strips markdown/HTML-sensitive chars from user strings used
// inside Render() markdown (defense-in-depth; the frontend also DOMPurifies).
func sanitizeForRender(s string) string {
	r := strings.NewReplacer(
		"<", "&lt;", ">", "&gt;",
		"[", "(", "]", ")",
		"`", "'", "|", "/",
		"\n", " ", "\r", " ",
	)
	return r.Replace(s)
}

// jsonEscape escapes a string for embedding in the realm's hand-built JSON.
func jsonEscape(s string) string {
	var b strings.Builder
	for _, c := range s {
		switch c {
		case '"':
			b.WriteString("\\\"")
		case '\\':
			b.WriteString("\\\\")
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case '\t':
			b.WriteString("\\t")
		default:
			if c < 0x20 {
				b.WriteString(ufmt.Sprintf("\\u%04x", int(c)))
			} else {
				b.WriteRune(c)
			}
		}
	}
	return b.String()
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `cd projects/memba/realms/memba_reviews_v1 && gno test .`
Expected: `TestInit` PASS.

- [ ] **Step 6: Commit** (on a `feat/reviews-realm` branch in samcrew-deployer — branch first)

```bash
git add projects/memba/realms/memba_reviews_v1/
git commit -m "scaffold memba_reviews_v1 realm: types, state, helpers"
```

---

## Task 2: PostReview / EditReview / DeleteReview + one-per-(author,subject) invariant (samcrew-deployer)

**Files:**
- Modify: `projects/memba/realms/memba_reviews_v1/memba_reviews_v1.gno`
- Test: `projects/memba/realms/memba_reviews_v1/memba_reviews_v1_test.gno`

**Interfaces:**
- Consumes: state + helpers from Task 1.
- Produces: `PostReview(cur realm, subject string, rating int, body string)`, `EditReview(cur realm, reviewID uint64, rating int, body string)`, `DeleteReview(cur realm, reviewID uint64)`. Invariant: at most one non-deleted `Review` per `(author, subject)`; re-posting the same pair updates in place. `authorSubject` key = `subject + "\x00" + author.String()`.

- [ ] **Step 1: Write failing tests** (append to `memba_reviews_v1_test.gno`)

```gno
import (
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	alice = testutils.TestAddress("rev_alice")
	bob   = testutils.TestAddress("rev_bob")
	subjA = "g1validatorsubjectaaaaaaaaaaaaaaaaaaaaaa"
)

func asUser(addr address) { testing.SetRealm(testing.NewUserRealm(addr)) }

func TestPostReview_CreatesOne(t *testing.T) {
	asUser(alice)
	PostReview(cross, subjA, 4, "solid uptime")

	ids := idList(subjectIndex, subjA)
	uassert.Equal(t, 1, len(ids), "one review indexed for subject")
	r, ok := getReview(ids[0])
	uassert.True(t, ok, "review exists")
	uassert.Equal(t, 4, r.Rating, "rating stored")
	uassert.Equal(t, "solid uptime", r.Body, "body stored")
	uassert.Equal(t, alice.String(), r.Author.String(), "author = caller")
}

func TestPostReview_SecondReplacesInPlace(t *testing.T) {
	asUser(bob)
	s := "g1subjreplaceinplacebbbbbbbbbbbbbbbbbbbbb"
	PostReview(cross, s, 2, "was down a lot")
	PostReview(cross, s, 5, "fixed it, great now")

	ids := idList(subjectIndex, s)
	uassert.Equal(t, 1, len(ids), "still one review for the pair")
	r, _ := getReview(ids[0])
	uassert.Equal(t, 5, r.Rating, "rating updated")
	uassert.Equal(t, "fixed it, great now", r.Body, "body updated")
	uassert.True(t, r.EditedAt > 0, "editedAt set on in-place update")
}

func TestPostReview_RejectsBadRating(t *testing.T) {
	asUser(alice)
	uassert.AbortsWithMessage(t, "rating must be 1..5", func() {
		PostReview(cross, "g1subjratingccccccccccccccccccccccccccc", 6, "x")
	})
}

func TestPostReview_RejectsOverlongBody(t *testing.T) {
	asUser(alice)
	long := strings.Repeat("x", MaxBodyLen+1)
	uassert.AbortsWithMessage(t, "body too long", func() {
		PostReview(cross, "g1subjbodyddddddddddddddddddddddddddddd", 3, long)
	})
}

func TestEditReview_AuthorOnly(t *testing.T) {
	asUser(alice)
	s := "g1subjediteeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	PostReview(cross, s, 3, "ok")
	id := idList(subjectIndex, s)[0]

	asUser(bob)
	uassert.AbortsWithMessage(t, "author only", func() {
		EditReview(cross, id, 1, "hijack")
	})
}

func TestDeleteReview_Tombstones(t *testing.T) {
	asUser(alice)
	s := "g1subjdelffffffffffffffffffffffffffffff"
	PostReview(cross, s, 3, "delete me")
	id := idList(subjectIndex, s)[0]
	DeleteReview(cross, id)

	r, _ := getReview(id)
	uassert.True(t, r.Deleted, "marked deleted")
	uassert.Equal(t, "", r.Body, "body cleared")
	// pair freed: author can post a fresh review for the same subject
	PostReview(cross, s, 5, "re-reviewed")
	uassert.Equal(t, 2, len(idList(subjectIndex, s)), "new review appended after delete")
}
```

- [ ] **Step 2: Run — expect FAIL** (`PostReview` undefined). Run: `gno test .`

- [ ] **Step 3: Implement the write funcs** (append to `memba_reviews_v1.gno`)

```gno
func pairKey(subject string, a address) string { return subject + "\x00" + a.String() }

// PostReview creates the caller's review for `subject`, or replaces it in place
// if one already exists (the "one editable review per pair" rule).
func PostReview(cur realm, subject string, rating int, body string) {
	caller := unsafe.PreviousRealm().Address()
	if subject == "" {
		panic("subject required")
	}
	if rating < 1 || rating > 5 {
		panic("rating must be 1..5")
	}
	if len(body) > MaxBodyLen {
		panic("body too long")
	}

	pk := pairKey(subject, caller)
	if v, ok := authorSubject.Get(pk); ok {
		r, found := getReview(v.(uint64))
		if found && !r.Deleted {
			r.Rating = rating
			r.Body = body
			r.EditedAt = runtime.ChainHeight()
			reviews.Set(strID(r.ID), r)
			chain.Emit("ReviewUpdated", "id", strID(r.ID), "subject", subject)
			return
		}
	}

	id := nextID
	nextID++
	r := &Review{
		ID:        id,
		Subject:   subject,
		Author:    caller,
		Rating:    rating,
		Body:      body,
		CreatedAt: runtime.ChainHeight(),
	}
	reviews.Set(strID(id), r)
	authorSubject.Set(pk, id)
	subjectIndex.Set(subject, append(idList(subjectIndex, subject), id))
	chain.Emit("ReviewPosted", "id", strID(id), "subject", subject, "author", caller.String())
}

func EditReview(cur realm, reviewID uint64, rating int, body string) {
	caller := unsafe.PreviousRealm().Address()
	r, ok := getReview(reviewID)
	if !ok || r.Deleted {
		panic("review not found")
	}
	if r.Author != caller {
		panic("author only")
	}
	if rating < 1 || rating > 5 {
		panic("rating must be 1..5")
	}
	if len(body) > MaxBodyLen {
		panic("body too long")
	}
	r.Rating = rating
	r.Body = body
	r.EditedAt = runtime.ChainHeight()
	reviews.Set(strID(reviewID), r)
	chain.Emit("ReviewUpdated", "id", strID(reviewID), "subject", r.Subject)
}

// DeleteReview tombstones the caller's review: keeps the ID + reaction history,
// clears the body, frees the (author,subject) pair for a fresh review.
func DeleteReview(cur realm, reviewID uint64) {
	caller := unsafe.PreviousRealm().Address()
	r, ok := getReview(reviewID)
	if !ok || r.Deleted {
		panic("review not found")
	}
	if r.Author != caller {
		panic("author only")
	}
	r.Deleted = true
	r.Body = ""
	reviews.Set(strID(reviewID), r)
	authorSubject.Remove(pairKey(r.Subject, caller))
	chain.Emit("ReviewDeleted", "id", strID(reviewID), "subject", r.Subject)
}
```

- [ ] **Step 4: Run — expect PASS** (all Task-2 tests). Run: `gno test .`

- [ ] **Step 5: Commit**

```bash
git add projects/memba/realms/memba_reviews_v1/
git commit -m "memba_reviews_v1: post/edit/delete review + one-per-pair invariant"
```

---

## Task 3: Comment / EditComment / DeleteComment (flat, one level) (samcrew-deployer)

**Files:**
- Modify: `memba_reviews_v1.gno`
- Test: `memba_reviews_v1_test.gno`

**Interfaces:**
- Consumes: review state + helpers.
- Produces: `Comment(cur realm, reviewID uint64, body string)`, `EditComment(cur realm, commentID uint64, body string)`, `DeleteComment(cur realm, commentID uint64)`. `commentIndex` key = `strID(reviewID)`.

- [ ] **Step 1: Write failing tests** (append)

```gno
func TestComment_AddsToReview(t *testing.T) {
	asUser(alice)
	s := "g1subjcommentggggggggggggggggggggggggggg"
	PostReview(cross, s, 4, "good")
	rid := idList(subjectIndex, s)[0]

	asUser(bob)
	Comment(cross, rid, "agreed, also fast")

	cids := idList(commentIndex, strID(rid))
	uassert.Equal(t, 1, len(cids), "one comment indexed")
	c, _ := getComment(cids[0])
	uassert.Equal(t, "agreed, also fast", c.Body, "comment body stored")
	uassert.Equal(t, bob.String(), c.Author.String(), "comment author = caller")
	uassert.Equal(t, rid, c.ReviewID, "comment links to review")
}

func TestComment_RejectsMissingReview(t *testing.T) {
	asUser(alice)
	uassert.AbortsWithMessage(t, "review not found", func() {
		Comment(cross, 99999, "no parent")
	})
}

func TestEditComment_AuthorOnly(t *testing.T) {
	asUser(alice)
	s := "g1subjcedithhhhhhhhhhhhhhhhhhhhhhhhhhhhh"
	PostReview(cross, s, 4, "good")
	rid := idList(subjectIndex, s)[0]
	asUser(bob)
	Comment(cross, rid, "mine")
	cid := idList(commentIndex, strID(rid))[0]

	asUser(alice)
	uassert.AbortsWithMessage(t, "author only", func() { EditComment(cross, cid, "steal") })
}
```

- [ ] **Step 2: Run — expect FAIL** (`Comment` undefined). Run: `gno test .`

- [ ] **Step 3: Implement** (append to `memba_reviews_v1.gno`)

```gno
func Comment(cur realm, reviewID uint64, body string) {
	caller := unsafe.PreviousRealm().Address()
	r, ok := getReview(reviewID)
	if !ok || r.Deleted {
		panic("review not found")
	}
	if body == "" || len(body) > MaxCommentLen {
		panic("comment length invalid")
	}
	id := nextID
	nextID++
	c := &Comment{ID: id, ReviewID: reviewID, Author: caller, Body: body, CreatedAt: runtime.ChainHeight()}
	comments.Set(strID(id), c)
	commentIndex.Set(strID(reviewID), append(idList(commentIndex, strID(reviewID)), id))
	chain.Emit("CommentPosted", "id", strID(id), "review", strID(reviewID), "author", caller.String())
}

func EditComment(cur realm, commentID uint64, body string) {
	caller := unsafe.PreviousRealm().Address()
	c, ok := getComment(commentID)
	if !ok || c.Deleted {
		panic("comment not found")
	}
	if c.Author != caller {
		panic("author only")
	}
	if body == "" || len(body) > MaxCommentLen {
		panic("comment length invalid")
	}
	c.Body = body
	c.EditedAt = runtime.ChainHeight()
	comments.Set(strID(commentID), c)
	chain.Emit("CommentUpdated", "id", strID(commentID))
}

func DeleteComment(cur realm, commentID uint64) {
	caller := unsafe.PreviousRealm().Address()
	c, ok := getComment(commentID)
	if !ok || c.Deleted {
		panic("comment not found")
	}
	if c.Author != caller {
		panic("author only")
	}
	c.Deleted = true
	c.Body = ""
	comments.Set(strID(commentID), c)
	chain.Emit("CommentDeleted", "id", strID(commentID))
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `gno test .`

- [ ] **Step 5: Commit**

```bash
git commit -am "memba_reviews_v1: flat one-level comments (add/edit/delete)"
```

---

## Task 4: React (like/dislike toggle) + O(1) reputation counter + self-react rejection (samcrew-deployer)

**Files:**
- Modify: `memba_reviews_v1.gno`
- Test: `memba_reviews_v1_acl_test.gno` (CREATE)

**Interfaces:**
- Consumes: review/comment state, `reputation` helpers.
- Produces: `React(cur realm, targetID uint64, kind string)` where `kind ∈ {"like","dislike"}`. One reaction per `(account, targetID)`; re-reacting the same kind toggles OFF; the other kind switches. Updates the target's `Likes`/`Dislikes` AND the target author's `reputation` by Δ(likes−dislikes). **Self-reaction panics.** Works on reviews and comments (shared ID space).

- [ ] **Step 1: Write failing ACL/reputation tests** (`memba_reviews_v1_acl_test.gno`)

```gno
package memba_reviews_v1

import (
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	rAuthor = testutils.TestAddress("rx_author")
	rLiker  = testutils.TestAddress("rx_liker")
)

func setUser(a address) { testing.SetRealm(testing.NewUserRealm(a)) }

func newReview(subject string, author address) uint64 {
	setUser(author)
	PostReview(cross, subject, 4, "body")
	ids := idList(subjectIndex, subject)
	return ids[len(ids)-1]
}

func TestReact_LikeMovesReputation(t *testing.T) {
	rid := newReview("g1subjreactaaaaaaaaaaaaaaaaaaaaaaaaaaaa", rAuthor)
	setUser(rLiker)
	React(cross, rid, "like")

	r, _ := getReview(rid)
	uassert.Equal(t, uint64(1), r.Likes, "like counted")
	uassert.Equal(t, int64(1), getReputation(rAuthor.String()), "author rep +1")
}

func TestReact_ToggleOffReversesReputation(t *testing.T) {
	rid := newReview("g1subjreactbbbbbbbbbbbbbbbbbbbbbbbbbbbb", rAuthor)
	setUser(rLiker)
	React(cross, rid, "like")
	React(cross, rid, "like") // same kind again → toggle off

	r, _ := getReview(rid)
	uassert.Equal(t, uint64(0), r.Likes, "like removed")
	uassert.Equal(t, int64(0), getReputation(rAuthor.String()), "rep back to 0")
}

func TestReact_SwitchLikeToDislike(t *testing.T) {
	rid := newReview("g1subjreactcccccccccccccccccccccccccccc", rAuthor)
	setUser(rLiker)
	React(cross, rid, "like")
	React(cross, rid, "dislike") // switch

	r, _ := getReview(rid)
	uassert.Equal(t, uint64(0), r.Likes, "like cleared")
	uassert.Equal(t, uint64(1), r.Dislikes, "dislike set")
	uassert.Equal(t, int64(-1), getReputation(rAuthor.String()), "rep now -1")
}

func TestReact_SelfReactionRejected(t *testing.T) {
	rid := newReview("g1subjreactdddddddddddddddddddddddddddd", rAuthor)
	setUser(rAuthor)
	uassert.AbortsWithMessage(t, "cannot react to your own", func() {
		React(cross, rid, "like")
	})
}

func TestReact_RejectsBadKind(t *testing.T) {
	rid := newReview("g1subjreacteeeeeeeeeeeeeeeeeeeeeeeeeeee", rAuthor)
	setUser(rLiker)
	uassert.AbortsWithMessage(t, "kind must be like or dislike", func() {
		React(cross, rid, "love")
	})
}
```

- [ ] **Step 2: Run — expect FAIL** (`React` undefined). Run: `gno test .`

- [ ] **Step 3: Implement React** (append to `memba_reviews_v1.gno`)

> Implement `React` with an explicit review-or-comment branch (gno has no generics/pointer-to-field ergonomics worth fighting; the branch is clearer and avoids aliasing bugs). Use exactly this:

```gno
func React(cur realm, targetID uint64, kind string) {
	caller := unsafe.PreviousRealm().Address()
	if kind != "like" && kind != "dislike" {
		panic("kind must be like or dislike")
	}

	// Resolve target author + apply counter/reputation deltas via a closure that
	// reads/writes whichever entity holds targetID.
	r, isReview := getReview(targetID)
	c, isComment := getComment(targetID)
	if !isReview && !isComment {
		panic("target not found")
	}

	var author address
	if isReview {
		author = r.Author
	} else {
		author = c.Author
	}
	if author == caller {
		panic("cannot react to your own review or comment")
	}

	rk := strID(targetID) + "/" + caller.String()
	var old string
	if v, ok := reactions.Get(rk); ok {
		old = v.(string)
	}

	newKind := kind
	if old == kind {
		newKind = "" // toggle off
	}

	likesDelta := boolToInt(newKind == "like") - boolToInt(old == "like")
	dislikesDelta := boolToInt(newKind == "dislike") - boolToInt(old == "dislike")
	repDelta := int64(likesDelta - dislikesDelta)

	if newKind == "" {
		reactions.Remove(rk)
	} else {
		reactions.Set(rk, newKind)
	}

	if isReview {
		r.Likes = applyDelta(r.Likes, likesDelta)
		r.Dislikes = applyDelta(r.Dislikes, dislikesDelta)
		reviews.Set(strID(targetID), r)
	} else {
		c.Likes = applyDelta(c.Likes, likesDelta)
		c.Dislikes = applyDelta(c.Dislikes, dislikesDelta)
		comments.Set(strID(targetID), c)
	}
	addReputation(author.String(), repDelta)
	chain.Emit("Reacted", "target", strID(targetID), "kind", newKind, "by", caller.String())
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// applyDelta adjusts an unsigned counter by ±1 without underflow.
func applyDelta(v uint64, delta int) uint64 {
	if delta < 0 {
		if v == 0 {
			return 0
		}
		return v - uint64(-delta)
	}
	return v + uint64(delta)
}
```

- [ ] **Step 4: Run — expect PASS** (all Task-4 tests). Run: `gno test .`

- [ ] **Step 5: Commit**

```bash
git commit -am "memba_reviews_v1: like/dislike React + O(1) reputation, self-react rejected"
```

---

## Task 5: Flag (community) + auto-hide threshold + multisig Hide/Unhide (samcrew-deployer)

**Files:**
- Modify: `memba_reviews_v1.gno`
- Test: `memba_reviews_v1_acl_test.gno`

**Interfaces:**
- Consumes: review/comment state, `assertModerator`, `flags`, `flaggedIDs`.
- Produces: `Flag(cur realm, targetID uint64)` (one per account; bumps `FlagCount`; at `FlagThreshold` sets `Hidden=true`); `HideReview/HideComment(cur realm, id uint64)`, `Unhide(cur realm, targetID uint64)` (multisig-only).

- [ ] **Step 1: Write failing tests** (append to `_acl_test.gno`)

```gno
var rFlagger2 = testutils.TestAddress("rx_flag2")

func TestFlag_OncePerAccount(t *testing.T) {
	rid := newReview("g1subjflagaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", rAuthor)
	setUser(rLiker)
	Flag(cross, rid)
	uassert.AbortsWithMessage(t, "already flagged", func() { Flag(cross, rid) })
	r, _ := getReview(rid)
	uassert.Equal(t, uint64(1), r.FlagCount, "flag counted once")
}

func TestHide_MultisigOnly(t *testing.T) {
	rid := newReview("g1subjflagbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", rAuthor)
	setUser(rLiker)
	uassert.AbortsWithMessage(t, "moderator multisig only", func() { HideReview(cross, rid) })

	setUser(address(ModeratorAddress))
	HideReview(cross, rid)
	r, _ := getReview(rid)
	uassert.True(t, r.Hidden, "moderator hid the review")

	Unhide(cross, rid)
	r2, _ := getReview(rid)
	uassert.False(t, r2.Hidden, "moderator unhid the review")
}
```

- [ ] **Step 2: Run — expect FAIL** (`Flag`/`HideReview` undefined). Run: `gno test .`

- [ ] **Step 3: Implement** (append to `memba_reviews_v1.gno`)

```gno
func Flag(cur realm, targetID uint64) {
	caller := unsafe.PreviousRealm().Address()
	r, isReview := getReview(targetID)
	c, isComment := getComment(targetID)
	if !isReview && !isComment {
		panic("target not found")
	}
	fk := strID(targetID) + "/" + caller.String()
	if _, ok := flags.Get(fk); ok {
		panic("already flagged")
	}
	flags.Set(fk, true)

	if isReview {
		r.FlagCount++
		if r.FlagCount >= FlagThreshold {
			r.Hidden = true
		}
		reviews.Set(strID(targetID), r)
	} else {
		c.FlagCount++
		if c.FlagCount >= FlagThreshold {
			c.Hidden = true
		}
		comments.Set(strID(targetID), c)
	}
	flaggedIDs.Set(strID(targetID), true)
	chain.Emit("Flagged", "target", strID(targetID), "by", caller.String())
}

func HideReview(cur realm, id uint64) {
	assertModerator()
	r, ok := getReview(id)
	if !ok {
		panic("review not found")
	}
	r.Hidden = true
	reviews.Set(strID(id), r)
	chain.Emit("Hidden", "target", strID(id))
}

func HideComment(cur realm, id uint64) {
	assertModerator()
	c, ok := getComment(id)
	if !ok {
		panic("comment not found")
	}
	c.Hidden = true
	comments.Set(strID(id), c)
	chain.Emit("Hidden", "target", strID(id))
}

func Unhide(cur realm, targetID uint64) {
	assertModerator()
	if r, ok := getReview(targetID); ok {
		r.Hidden = false
		reviews.Set(strID(targetID), r)
		flaggedIDs.Remove(strID(targetID))
		chain.Emit("Unhidden", "target", strID(targetID))
		return
	}
	if c, ok := getComment(targetID); ok {
		c.Hidden = false
		comments.Set(strID(targetID), c)
		flaggedIDs.Remove(strID(targetID))
		chain.Emit("Unhidden", "target", strID(targetID))
		return
	}
	panic("target not found")
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `gno test .`

- [ ] **Step 5: Commit**

```bash
git commit -am "memba_reviews_v1: community flag + auto-hide threshold + multisig hide/unhide"
```

---

## Task 6: Paginated JSON reads + reputation read + Render (samcrew-deployer)

**Files:**
- Modify: `memba_reviews_v1.gno`
- Test: `memba_reviews_v1_test.gno`

**Interfaces:**
- Consumes: all state.
- Produces (all queried via RPC `vm/qeval`): `GetReviewsJSON(subject string, offset, limit int) string`, `GetCommentsJSON(reviewID uint64, offset, limit int) string`, `GetSubjectSummaryJSON(subject string) string`, `GetReputation(addr string) int64`, `GetFlaggedJSON(offset, limit int) string`, and `Render(path string) string`. JSON excludes `Hidden`; includes `Deleted` tombstones with empty body (so threads stay coherent). All lists windowed; `limit` clamped to `MaxPageLimit`.

- [ ] **Step 1: Write failing tests** (append to `_test.gno`)

```gno
func TestGetReviewsJSON_ShapeAndPagination(t *testing.T) {
	s := "g1subjreadjsonaaaaaaaaaaaaaaaaaaaaaaaaa"
	asUser(alice)
	PostReview(cross, s, 5, "great \"quoted\" body")
	out := GetReviewsJSON(s, 0, 10)
	uassert.True(t, strings.Contains(out, "\"rating\":5"), "rating in json")
	uassert.True(t, strings.Contains(out, "\\\"quoted\\\""), "body json-escaped")
	uassert.True(t, strings.Contains(out, "\"author\":\""+alice.String()+"\""), "author in json")
}

func TestGetReviewsJSON_ExcludesHidden(t *testing.T) {
	s := "g1subjreadhiddenbbbbbbbbbbbbbbbbbbbbbbb"
	asUser(alice)
	PostReview(cross, s, 4, "visible body keyword ALPHA")
	rid := idList(subjectIndex, s)[0]
	setUser(address(ModeratorAddress))
	HideReview(cross, rid)
	out := GetReviewsJSON(s, 0, 10)
	uassert.False(t, strings.Contains(out, "ALPHA"), "hidden review excluded from reads")
}

func TestGetSubjectSummaryJSON(t *testing.T) {
	s := "g1subjsummaryccccccccccccccccccccccccc"
	asUser(alice)
	PostReview(cross, s, 4, "a")
	asUser(bob)
	PostReview(cross, s, 2, "b")
	out := GetSubjectSummaryJSON(s)
	uassert.True(t, strings.Contains(out, "\"count\":2"), "count=2")
	uassert.True(t, strings.Contains(out, "\"average\":3"), "average=3 (4+2)/2")
}
```

- [ ] **Step 2: Run — expect FAIL.** Run: `gno test .`

- [ ] **Step 3: Implement reads + Render** (append to `memba_reviews_v1.gno`)

```gno
func clampLimit(limit int) int {
	if limit <= 0 || limit > MaxPageLimit {
		return MaxPageLimit
	}
	return limit
}

func window(ids []uint64, offset, limit int) []uint64 {
	limit = clampLimit(limit)
	if offset < 0 {
		offset = 0
	}
	if offset >= len(ids) {
		return nil
	}
	end := offset + limit
	if end > len(ids) {
		end = len(ids)
	}
	return ids[offset:end]
}

func reviewJSON(r *Review) string {
	return ufmt.Sprintf(
		`{"id":%d,"subject":"%s","author":"%s","rating":%d,"body":"%s","createdAt":%d,"editedAt":%d,"deleted":%t,"likes":%d,"dislikes":%d,"flags":%d,"reputation":%d}`,
		r.ID, jsonEscape(r.Subject), r.Author.String(), r.Rating, jsonEscape(r.Body),
		r.CreatedAt, r.EditedAt, r.Deleted, r.Likes, r.Dislikes, r.FlagCount,
		getReputation(r.Author.String()),
	)
}

func commentJSON(c *Comment) string {
	return ufmt.Sprintf(
		`{"id":%d,"reviewId":%d,"author":"%s","body":"%s","createdAt":%d,"editedAt":%d,"deleted":%t,"likes":%d,"dislikes":%d,"flags":%d,"reputation":%d}`,
		c.ID, c.ReviewID, c.Author.String(), jsonEscape(c.Body),
		c.CreatedAt, c.EditedAt, c.Deleted, c.Likes, c.Dislikes, c.FlagCount,
		getReputation(c.Author.String()),
	)
}

// GetReviewsJSON returns a JSON array of a subject's non-hidden reviews (paginated).
func GetReviewsJSON(subject string, offset, limit int) string {
	ids := window(idList(subjectIndex, subject), offset, limit)
	var b strings.Builder
	b.WriteString("[")
	first := true
	for _, id := range ids {
		r, ok := getReview(id)
		if !ok || r.Hidden {
			continue
		}
		if !first {
			b.WriteString(",")
		}
		b.WriteString(reviewJSON(r))
		first = false
	}
	b.WriteString("]")
	return b.String()
}

func GetCommentsJSON(reviewID uint64, offset, limit int) string {
	ids := window(idList(commentIndex, strID(reviewID)), offset, limit)
	var b strings.Builder
	b.WriteString("[")
	first := true
	for _, id := range ids {
		c, ok := getComment(id)
		if !ok || c.Hidden {
			continue
		}
		if !first {
			b.WriteString(",")
		}
		b.WriteString(commentJSON(c))
		first = false
	}
	b.WriteString("]")
	return b.String()
}

// GetSubjectSummaryJSON returns {"count":N,"average":A} over non-hidden,
// non-deleted reviews. Average is integer-rounded ×1 (frontend divides for tenths).
func GetSubjectSummaryJSON(subject string) string {
	ids := idList(subjectIndex, subject)
	var sum, n int64
	for _, id := range ids {
		r, ok := getReview(id)
		if !ok || r.Hidden || r.Deleted {
			continue
		}
		sum += int64(r.Rating)
		n++
	}
	avg := int64(0)
	if n > 0 {
		avg = (sum + n/2) / n // rounded
	}
	return ufmt.Sprintf(`{"count":%d,"average":%d,"sum":%d}`, n, avg, sum)
}

func GetReputation(addr string) int64 { return getReputation(addr) }

// GetFlaggedJSON returns visible-but-flagged target IDs for the mod dashboard.
func GetFlaggedJSON(offset, limit int) string {
	var ids []uint64
	flaggedIDs.Iterate("", "", func(key string, _ interface{}) bool {
		id, _ := strconv.ParseUint(key, 10, 64)
		ids = append(ids, id)
		return false
	})
	ids = window(ids, offset, limit)
	var b strings.Builder
	b.WriteString("[")
	for i, id := range ids {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(strID(id))
	}
	b.WriteString("]")
	return b.String()
}

// Render — human gnoweb view. path "" = home; "s/<subject>" = a subject's reviews.
func Render(path string) string {
	if path == "" {
		return ufmt.Sprintf("# Memba Reviews\n\nOn-chain web-of-trust. %d reviews total.\n", reviews.Size())
	}
	if strings.HasPrefix(path, "s/") {
		subject := strings.TrimPrefix(path, "s/")
		var b strings.Builder
		b.WriteString("# Reviews for " + sanitizeForRender(subject) + "\n\n")
		for _, id := range idList(subjectIndex, subject) {
			r, ok := getReview(id)
			if !ok || r.Hidden || r.Deleted {
				continue
			}
			b.WriteString(ufmt.Sprintf("**%d/5** by %s\n\n%s\n\n---\n",
				r.Rating, r.Author.String(), sanitizeForRender(r.Body)))
		}
		return b.String()
	}
	return "# 404\n"
}
```

- [ ] **Step 4: Run — expect PASS** (all read tests). Run: `gno test .`

- [ ] **Step 5: Run the full realm test suite + vet**

Run: `cd projects/memba/realms/memba_reviews_v1 && gno test . && gno lint . 2>/dev/null || true`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "memba_reviews_v1: paginated JSON reads, summary, reputation read, Render"
```

---

## Task 7: Wire realm into the deployer (samcrew-deployer)

**Files:**
- Modify: `projects/memba/deploy.sh`

**Interfaces:**
- Consumes: the finished realm dir.
- Produces: a deploy block + a dry-run that lists the realm. **Does NOT deploy** — deploy is Task 9, gated on Task 8.

- [ ] **Step 1: Read the existing deploy blocks** to copy the exact `deploy_with_retry` pattern.

Run: `grep -n "deploy_with_retry\|REALMS_DIR\|log_section" projects/memba/deploy.sh | head -30`

- [ ] **Step 2: Add a deploy block** for `memba_reviews_v1` following the existing per-realm pattern (after the last self-contained realm, e.g. agent_registry):

```bash
log_section "Realm: memba_reviews_v1 (web-of-trust)"
if [[ -d "$REALMS_DIR/memba_reviews_v1" ]]; then
    deploy_with_retry "gno.land/r/samcrew/memba_reviews_v1" "$REALMS_DIR/memba_reviews_v1" "$DEPLOY_KEY"
else
    log_warn "memba_reviews_v1 source not found — skipping"
fi
```

- [ ] **Step 3: Dry-run to confirm it's picked up (no broadcast)**

Run: `DRY_RUN=true ./projects/memba/deploy.sh test13 2>&1 | grep -i reviews`
Expected: a line referencing `memba_reviews_v1`.

- [ ] **Step 4: Commit**

```bash
git commit -am "deploy: register memba_reviews_v1 realm (deploy gated on security review)"
```

---

## Task 8: MANDATORY security review (hard gate) (samcrew-deployer)

**Files:** none changed initially; fixes land in `memba_reviews_v1.gno` / tests as findings dictate.

**Interfaces:** Produces a findings doc + a clean re-review. **No deploy until this passes.**

- [ ] **Step 1: Run the Samourai Gno Security Guard analyzer** against the realm.

Run (adjust to the analyzer's actual CLI in `/Users/zxxma/Desktop/Code/Gno/Samourai Gno Security Guard`):
```bash
cd "/Users/zxxma/Desktop/Code/Gno/Samourai Gno Security Guard"
# e.g.: go run ./cmd/guard analyze --path /Users/zxxma/Desktop/Code/Gno/samcrew-deployer/projects/memba/realms/memba_reviews_v1
```
Capture all findings to `docs/superpowers/reviews/2026-06-26-reviews-realm-security.md` (in Memba repo) or the deployer's review dir.

- [ ] **Step 2: Manual review pass** — walk each checklist item from spec §8 and assert it holds, citing the line:
  - **Auth:** every write derives caller from `unsafe.PreviousRealm().Address()` (never a param); `EditReview/DeleteReview/EditComment/DeleteComment` enforce `author == caller`; `HideReview/HideComment/Unhide` call `assertModerator()`.
  - **Reputation integrity:** mutated ONLY inside `React`; self-react panics; toggle/switch deltas reverse exactly (the Task-4 tests prove all transitions); no exported path sets reputation directly; `int64` (can go negative, no overflow at realistic volumes); `applyDelta` never underflows a `uint64` counter.
  - **Gas/DoS:** every list read goes through `window()` (clamped to `MaxPageLimit`); `Render` skips hidden/deleted and only walks the subject index; no unbounded loop in any write (append-only index growth bounded by distinct authors — one review per pair).
  - **Immutability/legal:** body is permanent; `Hide` (multisig) + auto-hide (≥`FlagThreshold`) are the only takedowns; they omit from reads but cannot erase chain history — DOCUMENT this for users in the UI (Task 13).
  - **Input limits:** `rating ∈ 1..5`; body ≤ `MaxBodyLen`; comment ≤ `MaxCommentLen`, non-empty; `kind ∈ {like,dislike}`; subject non-empty. `sanitizeForRender` on all user strings in `Render`.
  - **Self-review edge:** confirm a user CAN review/comment but CANNOT react to their own content (the only self-restriction by design).

- [ ] **Step 3: Fix every actionable finding** with a failing test first (TDD), then re-run `gno test .`.

- [ ] **Step 4: Re-run the analyzer until clean.** Record the clean run + sign-off in the findings doc.

- [ ] **Step 5: STOP — report findings + the clean re-review to the user. Get explicit approval to deploy (Task 9).**

---

## Task 9: Deploy to test13 via samcrew-deployer (REQUIRES USER) (samcrew-deployer)

**Files:** none (operational).

**Interfaces:** Produces the live realm at `gno.land/r/samcrew/memba_reviews_v1` on test13.

- [ ] **Step 1: Confirm `ModeratorAddress`** with the user is the intended Memba moderator multisig (it's the same multisig used as owner by `agent_registry`/`candidature_v2`). Fix the constant + re-test if different (changes the realm → still `_v1` since never deployed).

- [ ] **Step 2: Pre-flight + dry-run.** Run: `DRY_RUN=true ./projects/memba/deploy.sh test13`.

- [ ] **Step 3: Deploy** (multisig signing flow per `lib/deploy.sh`). This is a chain write — **only on explicit user go-ahead.**

```bash
./projects/memba/deploy.sh test13   # deploys the reviews realm via the multisig flow
```

- [ ] **Step 4: Verify on-chain** — query a render + a JSON read:

```bash
gnokey query vm/qrender --data "gno.land/r/samcrew/memba_reviews_v1:" --remote https://rpc.test13.testnets.gno.land:443
gnokey query vm/qeval --data 'gno.land/r/samcrew/memba_reviews_v1.GetReputation("g1...")' --remote https://rpc.test13.testnets.gno.land:443
```
Expected: the home render markdown; `(0 int64)` for an unknown address. **Record the exact qeval return wrapping format** — it drives the Task 10 unwrap helper.

---

## Task 10: Frontend `lib/reviews.ts` — types + RPC qeval JSON reads + username join (Memba)

**Files:**
- Create: `frontend/src/lib/reviews.ts`
- Create: `frontend/src/lib/reviews.test.ts`

**Interfaces:**
- Consumes: `queryEval` from `lib/dao/shared.ts` (`queryEval(rpcUrl, pkgPath, expr) → Promise<string|null>`), `GNO_RPC_URL` from `lib/config.ts`, `resolveOnChainUsername` from `lib/profile.ts`.
- Produces: `OnChainReview`/`OnChainComment` types; `parseReviews(json) → OnChainReview[]`; `unwrapQeval(raw) → string`; `fetchReviews(subject, offset?, limit?)`, `fetchComments(reviewID, ...)`, `fetchSummary(subject)`, `fetchReputation(addr)`; `sortByTrust(reviews) → OnChainReview[]`; `REVIEWS_PKG_PATH`.

- [ ] **Step 1: Write failing pure-function tests** (`reviews.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import { unwrapQeval, parseReviews, sortByTrust } from "./reviews"

describe("unwrapQeval", () => {
  it("strips the gno (\"...\" string) wrapper and unquotes", () => {
    // qeval returns a string-typed value wrapped like: ("[...]" string)
    expect(unwrapQeval('("[{\\"id\\":1}]" string)')).toBe('[{"id":1}]')
  })
  it("passes through a bare JSON string", () => {
    expect(unwrapQeval('[{"id":1}]')).toBe('[{"id":1}]')
  })
})

describe("parseReviews", () => {
  it("parses the realm JSON array", () => {
    const out = parseReviews('[{"id":1,"subject":"g1x","author":"g1a","rating":5,"body":"hi","createdAt":10,"editedAt":0,"deleted":false,"likes":2,"dislikes":0,"flags":0,"reputation":3}]')
    expect(out).toHaveLength(1)
    expect(out[0].rating).toBe(5)
    expect(out[0].reputation).toBe(3)
  })
  it("returns [] on empty/garbage", () => {
    expect(parseReviews("[]")).toEqual([])
    expect(parseReviews("not json")).toEqual([])
  })
})

describe("sortByTrust", () => {
  it("orders by reputation desc then recency", () => {
    const a = { id: 1, reputation: 1, createdAt: 100 } as any
    const b = { id: 2, reputation: 5, createdAt: 50 } as any
    const c = { id: 3, reputation: 5, createdAt: 90 } as any
    expect(sortByTrust([a, b, c]).map(r => r.id)).toEqual([3, 2, 1])
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`./reviews` missing). Run: `cd frontend && npm test -- reviews`

- [ ] **Step 3: Implement reads** (`frontend/src/lib/reviews.ts`)

```ts
import { GNO_RPC_URL, MEMBA_DAO } from "./config"
import { queryEval } from "./dao/shared"
import { resolveOnChainUsername } from "./profile"

export const REVIEWS_PKG_PATH = MEMBA_DAO.reviewsPath

export interface OnChainReview {
  id: number
  subject: string
  author: string
  rating: number
  body: string
  createdAt: number
  editedAt: number
  deleted: boolean
  likes: number
  dislikes: number
  flags: number
  reputation: number
  // joined client-side:
  username?: string
}

export interface OnChainComment {
  id: number
  reviewId: number
  author: string
  body: string
  createdAt: number
  editedAt: number
  deleted: boolean
  likes: number
  dislikes: number
  flags: number
  reputation: number
  username?: string
}

/** vm/qeval returns a string value wrapped as `("<contents>" string)`. Unwrap + unquote. */
export function unwrapQeval(raw: string): string {
  const m = raw.match(/^\("([\s\S]*)" string\)$/)
  const inner = m ? m[1] : raw
  // un-escape the gno string literal (\" and \\)
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
}

export function parseReviews(json: string): OnChainReview[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function parseComments(json: string): OnChainComment[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Reputation desc, then most-recent first. */
export function sortByTrust<T extends { reputation: number; createdAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.reputation - a.reputation || b.createdAt - a.createdAt)
}

async function evalJSON(expr: string): Promise<string> {
  const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, expr)
  return raw ? unwrapQeval(raw) : ""
}

export async function fetchReviews(subject: string, offset = 0, limit = 20): Promise<OnChainReview[]> {
  const json = await evalJSON(`GetReviewsJSON(${JSON.stringify(subject)}, ${offset}, ${limit})`)
  return sortByTrust(parseReviews(json))
}

export async function fetchComments(reviewID: number, offset = 0, limit = 50): Promise<OnChainComment[]> {
  const json = await evalJSON(`GetCommentsJSON(${reviewID}, ${offset}, ${limit})`)
  return parseComments(json)
}

export interface SubjectSummary { count: number; average: number; sum: number }

export async function fetchSummary(subject: string): Promise<SubjectSummary> {
  const json = await evalJSON(`GetSubjectSummaryJSON(${JSON.stringify(subject)})`)
  try {
    const v = JSON.parse(json)
    return { count: v.count ?? 0, average: v.average ?? 0, sum: v.sum ?? 0 }
  } catch {
    return { count: 0, average: 0, sum: 0 }
  }
}

export async function fetchReputation(addr: string): Promise<number> {
  const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, `GetReputation(${JSON.stringify(addr)})`)
  // scalar int64 qeval returns e.g. "(3 int64)"
  const m = raw?.match(/^\((-?\d+)\s/)
  return m ? Number(m[1]) : 0
}

/** Join each distinct author to their r/sys/users @username (best-effort, deduped). */
export async function attachUsernames<T extends { author: string; username?: string }>(items: T[]): Promise<T[]> {
  const uniq = [...new Set(items.map((i) => i.author))]
  const map = new Map<string, string>()
  await Promise.all(
    uniq.map(async (a) => {
      const u = await resolveOnChainUsername(a)
      if (u) map.set(a, u)
    }),
  )
  return items.map((i) => ({ ...i, username: map.get(i.author) || undefined }))
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd frontend && npm test -- reviews`

- [ ] **Step 5: Commit** (Memba `feat/reviews-realm` branch)

```bash
git add frontend/src/lib/reviews.ts frontend/src/lib/reviews.test.ts
git commit -m "reviews: lib/reviews.ts reads (qeval JSON, summary, reputation, username join)"
```

---

## Task 11: Config + safety flag wiring (Memba)

**Files:**
- Modify: `frontend/src/lib/config.ts`
- Modify: `frontend/src/lib/safeFlags.ts`
- Modify: `frontend/.env.example`
- Test: `frontend/src/lib/safeFlags.test.ts` (existing — extend) or `frontend/src/lib/reviews.test.ts`

**Interfaces:**
- Produces: `MEMBA_DAO.reviewsPath`, `isReviewsEnabled()`, `isReviewsValid()`, `VITE_ENABLE_REVIEWS` ∈ `SAFETY_GATED_FLAGS`.

- [ ] **Step 1: Write a failing safeFlags test** (extend the existing `safeFlags.test.ts`; if absent, add to `reviews.test.ts`)

```ts
import { SAFETY_GATED_FLAGS, assertSafeFlags } from "./safeFlags"

it("gates VITE_ENABLE_REVIEWS", () => {
  expect(SAFETY_GATED_FLAGS).toContain("VITE_ENABLE_REVIEWS")
  expect(() => assertSafeFlags({ VITE_ENABLE_REVIEWS: "true" })).toThrow(/SAFETY GATE FAILED/)
  expect(() => assertSafeFlags({ VITE_ENABLE_REVIEWS: "false" })).not.toThrow()
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd frontend && npm test -- safeFlags reviews`

- [ ] **Step 3: Add the flag** to `frontend/src/lib/safeFlags.ts`:

```ts
export const SAFETY_GATED_FLAGS = [
    "VITE_ENABLE_NFT",
    "VITE_ENABLE_SERVICES",
    "VITE_ENABLE_TREASURY_SPEND",
    "VITE_ENABLE_AGENT_CREDITS",
    "VITE_ENABLE_REVIEWS",
] as const
```

- [ ] **Step 4: Add config** to `frontend/src/lib/config.ts` — `reviewsPath` in the `MEMBA_DAO` object, the realm in the test13 `REALM_ALLOWLIST`, and the helpers:

```ts
// inside MEMBA_DAO = { ... }
reviewsPath: import.meta.env.VITE_REVIEWS_REALM_PATH || "gno.land/r/samcrew/memba_reviews_v1",

// near isNftEnabled / isRealmValid:
export const isReviewsEnabled = (): boolean => import.meta.env.VITE_ENABLE_REVIEWS === "true"
export const isReviewsValid = (): boolean => isRealmValid(MEMBA_DAO.reviewsPath)
```
Also add `"gno.land/r/samcrew/memba_reviews_v1"` to the test13 `REALM_ALLOWLIST` array.

- [ ] **Step 5: Add to `.env.example`**

```
VITE_ENABLE_REVIEWS=false
```

- [ ] **Step 6: Run — expect PASS + build.** Run: `cd frontend && npm test -- safeFlags reviews && npm run build`
(`npm run build` is the real type-check — `tsc --noEmit` is a no-op here.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/config.ts frontend/src/lib/safeFlags.ts frontend/.env.example frontend/src/lib/*.test.ts
git commit -m "reviews: config path, allowlist, isReviews* helpers, VITE_ENABLE_REVIEWS safety gate (default off)"
```

---

## Task 12: Frontend writes — Adena MsgCall builders (Memba)

**Files:**
- Modify: `frontend/src/lib/reviews.ts`
- Test: `frontend/src/lib/reviews.test.ts`

**Interfaces:**
- Consumes: `buildMsgCall(func, args, caller)` + `doContractBroadcast(msgs, memo)` from `lib/grc20.ts`.
- Produces: `buildPostReviewMsg`, `buildEditReviewMsg`, `buildDeleteReviewMsg`, `buildReactMsg`, `buildCommentMsg`, `buildFlagMsg` (+ hide builders for the mod UI) and thin `submit*` wrappers calling `doContractBroadcast`.

- [ ] **Step 1: Write failing builder tests** (append to `reviews.test.ts`)

```ts
import { buildPostReviewMsg, buildReactMsg } from "./reviews"

it("builds a PostReview MsgCall", () => {
  const m = buildPostReviewMsg("g1caller", "g1subject", 5, "great")
  expect(m.type).toBe("vm/MsgCall")
  expect(m.value.func).toBe("PostReview")
  expect(m.value.pkg_path).toBe("gno.land/r/samcrew/memba_reviews_v1")
  expect(m.value.args).toEqual(["g1subject", "5", "great"])
  expect(m.value.caller).toBe("g1caller")
})

it("builds a React MsgCall", () => {
  const m = buildReactMsg("g1caller", 42, "like")
  expect(m.value.func).toBe("React")
  expect(m.value.args).toEqual(["42", "like"])
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd frontend && npm test -- reviews`

- [ ] **Step 3: Implement builders** (append to `reviews.ts`)

```ts
import { buildMsgCall, doContractBroadcast, type AminoMsg } from "./grc20"

export function buildPostReviewMsg(caller: string, subject: string, rating: number, body: string): AminoMsg {
  return buildMsgCall("PostReview", [subject, String(rating), body], caller, REVIEWS_PKG_PATH)
}
export function buildEditReviewMsg(caller: string, reviewID: number, rating: number, body: string): AminoMsg {
  return buildMsgCall("EditReview", [String(reviewID), String(rating), body], caller, REVIEWS_PKG_PATH)
}
export function buildDeleteReviewMsg(caller: string, reviewID: number): AminoMsg {
  return buildMsgCall("DeleteReview", [String(reviewID)], caller, REVIEWS_PKG_PATH)
}
export function buildReactMsg(caller: string, targetID: number, kind: "like" | "dislike"): AminoMsg {
  return buildMsgCall("React", [String(targetID), kind], caller, REVIEWS_PKG_PATH)
}
export function buildCommentMsg(caller: string, reviewID: number, body: string): AminoMsg {
  return buildMsgCall("Comment", [String(reviewID), body], caller, REVIEWS_PKG_PATH)
}
export function buildFlagMsg(caller: string, targetID: number): AminoMsg {
  return buildMsgCall("Flag", [String(targetID)], caller, REVIEWS_PKG_PATH)
}

export async function submitMsg(msg: AminoMsg, memo: string): Promise<string> {
  const { hash } = await doContractBroadcast([msg], memo)
  return hash
}
```

> NOTE: `buildMsgCall` in `lib/grc20.ts` is currently hardcoded to `GRC20_FACTORY_PATH`. Add an optional 4th param `pkgPath = GRC20_FACTORY_PATH` to that function (one-line, backward-compatible) so reviews can reuse it. If the maintainers prefer not to touch grc20.ts, inline an equivalent local `buildReviewMsgCall` in `reviews.ts` instead. Pick at implementation time; the tests above assume the param form.

- [ ] **Step 4: Run — expect PASS.** Run: `cd frontend && npm test -- reviews`

- [ ] **Step 5: Commit**

```bash
git commit -am "reviews: Adena MsgCall write builders (post/edit/delete/react/comment/flag)"
```

---

## Task 13: Reviews UI components (Memba)

**Files:**
- Create: `frontend/src/components/reviews/StarRating.tsx`
- Create: `frontend/src/components/reviews/ReviewCard.tsx`
- Create: `frontend/src/components/reviews/ReviewsSection.tsx`
- Create: `frontend/src/components/reviews/reviews.css`
- Test: `frontend/src/components/reviews/ReviewsSection.test.tsx`

**Interfaces:**
- Consumes: everything in `reviews.ts`, `useAdena` (address + connect state), `renderMarkdown` + `DOMPurify` for bodies, `isReviewsEnabled`.
- Produces: `<ReviewsSection subject={string} />` — summary (avg + count), trust-sorted list, write form (connect-gated), per-card react/reply/flag + author edit/delete + (if connected addr === ModeratorAddress) hide. Permanence notice shown near the form.

- [ ] **Step 1: Write a failing render test** (`ReviewsSection.test.tsx`) — mock `reviews.ts` fetchers, assert summary + a review body render and the connect-gate.

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { ReviewsSection } from "./ReviewsSection"

vi.mock("../../lib/reviews", () => ({
  fetchReviews: vi.fn().mockResolvedValue([
    { id: 1, subject: "g1s", author: "g1a", rating: 5, body: "great validator", createdAt: 1, editedAt: 0, deleted: false, likes: 2, dislikes: 0, flags: 0, reputation: 3, username: "@alice" },
  ]),
  fetchSummary: vi.fn().mockResolvedValue({ count: 1, average: 5, sum: 5 }),
  fetchComments: vi.fn().mockResolvedValue([]),
  attachUsernames: vi.fn().mockImplementation((x) => Promise.resolve(x)),
  REVIEWS_PKG_PATH: "gno.land/r/samcrew/memba_reviews_v1",
}))
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => ({ address: "", isConnected: false }) }))

describe("ReviewsSection", () => {
  it("shows summary + a review body and a connect gate", async () => {
    render(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText(/great validator/)).toBeInTheDocument()
    expect(screen.getByText(/5\.0/)).toBeInTheDocument()
    expect(screen.getByText(/connect/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd frontend && npm test -- ReviewsSection`

- [ ] **Step 3: Implement the components.** `StarRating.tsx` (display + input modes), `ReviewCard.tsx` (one review: stars, DOMPurified body, author line with `username || truncate(author)` + reputation, like/dislike/flag/reply controls calling the `submit*` helpers, author edit/delete when `address === author`, hide when `address === ModeratorAddress`), `ReviewsSection.tsx` (loads summary+reviews on mount, `attachUsernames`, renders the header average `(sum/count).toFixed(1)`, the trust-sorted list, the permanence notice — "Reviews are permanent on-chain; moderators can hide but not erase." — and a connect-gated `ReviewForm`). Body render uses the established safe pattern:

```tsx
<div className="review-body"
     dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(review.body || "")) }} />
```

All colors via `--color-k-*-text` tokens / `.k-brand-text` — **no hardcoded `color:`** (CI guardrail). Star fill may use an inline `--ck` brand hex through `.k-brand-text`.

- [ ] **Step 4: Run — expect PASS** + lint + build. Run: `cd frontend && npm test -- ReviewsSection && npm run lint && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/reviews/
git commit -m "reviews: ReviewsSection + ReviewCard + StarRating UI (tokens-only, DOMPurified bodies)"
```

---

## Task 14: Wire ReviewsSection into the profile pages behind the flag (Memba)

**Files:**
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/ValoperDetail.tsx`

**Interfaces:**
- Consumes: `<ReviewsSection>`, `isReviewsEnabled()`.
- Produces: a flag-gated Reviews section on both pages, subject = the page's address (or realm path for org profiles).

- [ ] **Step 1: ProfilePage** — add near the other section cards (e.g. after the Quest card ~line 295):

```tsx
{isReviewsEnabled() && address && (
  <ReviewsSection subject={address} />
)}
```
Import `ReviewsSection` + `isReviewsEnabled`.

- [ ] **Step 2: ValoperDetail** — add after the address rows section, subject = `valoper.operatorAddress`:

```tsx
{isReviewsEnabled() && valoper?.operatorAddress && (
  <ReviewsSection subject={valoper.operatorAddress} />
)}
```

- [ ] **Step 3: Verify the flag OFF path** (default) renders nothing new. Run: `cd frontend && npm run build && npm test`
Expected: green; no Reviews section without `VITE_ENABLE_REVIEWS=true`.

- [ ] **Step 4: Commit**

```bash
git commit -am "reviews: wire ReviewsSection into ProfilePage + ValoperDetail behind VITE_ENABLE_REVIEWS"
```

---

## Task 15: Live-verify on a deploy-preview, then flip the flag (REQUIRES USER)

**Files:** none (verification + flag flip).

- [ ] **Step 1: Open the PR** (after user approval to push) — CI must be green except the 2 known `directory.spec.ts` e2e flakes (`:57` seed DAO cards, `:66` DAO search). Verify those are the ONLY reds.

- [ ] **Step 2: On the deploy-preview** (`deploy-preview-<PR>--memba-multisig.netlify.app`), with the preview env `VITE_ENABLE_REVIEWS=true` (preview skips `assertSafeFlags`), exercise against the LIVE realm via chrome-devtools MCP:
  - A profile/valoper page shows the Reviews section, summary, and any seeded reviews.
  - Connect Adena → post a review → it appears; edit → updates; like another user's review → count + reputation move; reply; flag.
  - Light-mode contrast audit (force `data-theme=light`, walk text nodes, WCAG ratio) → **0 new offenders**; dark spot-check.

- [ ] **Step 3: Report results to the user.** On approval, merge (admin-squash, branch delete) — **only with explicit user OK.**

- [ ] **Step 4: Flip the flag for prod** — set `VITE_ENABLE_REVIEWS=true` in Netlify **production** env (NOT a gated `"true"` in the repo `.env`; the prod build's `assertSafeFlags` only passes because the flag is supplied via Netlify env after the realm is live + reviewed — confirm the gate semantics with the user, since `assertSafeFlags` fails the native prod build on any `SAFETY_GATED_FLAGS="true"`). **DECISION POINT:** either (a) remove `VITE_ENABLE_REVIEWS` from `SAFETY_GATED_FLAGS` now that the realm is live + reviewed (matches the file's own guidance: "To enable: remove from SAFETY_GATED_FLAGS … AND pass code review"), then set the Netlify prod env flag; or (b) keep it gated and feature-off in prod for now. Get the user's call.

- [ ] **Step 5: Verify on prod** (`memba.samourai.app`) the Reviews section is live and functional; confirm with the user before any mainnet consideration.

---

## Self-review (against spec)

- **§2 decisions:** open posting (no gate) ✓ Task 2; hybrid trust = reputation counter ✓ Task 4 + verified `@username` ✓ Task 10 `attachUsernames`/Task 13 display; hybrid moderation author-delete ✓ Task 2/3 + community Flag ✓ Task 5 + multisig Hide ✓ Task 5; fully on-chain + RPC reads ✓ Task 6/10, no backend ✓; subject key g1 OR realm path ✓ (generic string); rating required 1–5 + optional body ✓ Task 2; reactions one-per-(acct,target) toggle on reviews AND comments ✓ Task 4; flat one-level replies ✓ Task 3; self-likes disallowed ✓ Task 4; Adena-signed writes ✓ Task 12.
- **§3 model:** Review/Comment/Reaction/Flag/Reputation/Indexes/moderators all present ✓ Task 1; one-per-(author,subject) invariant ✓ Task 2; reputation updated only by React ✓ Task 4.
- **§4 API:** PostReview/EditReview/DeleteReview/React/Comment+Edit+Delete/Flag/Hide*/Unhide ✓ Tasks 2–5; GetReviews/GetComments/GetReputation/GetFlagged paginated ✓ Task 6.
- **§6 anti-spam:** one-per-pair, one-per-reaction, gas cost, negative reputation, self-likes off ✓; residual sybil risk documented ✓ (Task 8).
- **§7 frontend:** lib/reviews.ts reads+writes+join ✓ Tasks 10/12; wire into both pages behind `VITE_ENABLE_REVIEWS` ✓ Tasks 13/14.
- **§8 deploy+security:** samcrew-deployer versioned path ✓ Task 7/9; mandatory security review before deploy ✓ Task 8 (hard gate); all auth/reputation/DoS/immutability/input checklist items mapped ✓.
- **§9 build order:** realm+tests → security → deploy → lib reads→writes → wire → preview-verify+flip — matches Tasks 1–15.
- **§10 sub-points:** body 2000 / comment 1000 ✓; tombstone delete ✓; comments count toward reputation ✓ — all locked at top.

**Deviations from spec pseudocode (intentional, codebase-driven):** `std.PreviousRealm()` → `unsafe.PreviousRealm()`; block *time* → block *height* (`runtime.ChainHeight()`); machine reads via JSON-returning qeval funcs (not raw `[]Review`) for clean parsing; one global ID space for unambiguous `targetID`. All noted in Global Constraints / task notes.

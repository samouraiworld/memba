package account

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func call(t *testing.T, h http.Handler, method, path, token string, body any, header ...string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	switch b := body.(type) {
	case nil:
	case []byte:
		buf.Write(b)
	default:
		_ = json.NewEncoder(&buf).Encode(b)
	}
	req := httptest.NewRequest(method, path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var linkRE = regexp.MustCompile(`/os/confirm\?t=(\S+)`)

func lastLink(t *testing.T, f *fakeResend) string {
	t.Helper()
	sent := f.emails()
	if len(sent) == 0 {
		t.Fatal("no email sent")
	}
	m := linkRE.FindStringSubmatch(sent[len(sent)-1].Text)
	if m == nil {
		t.Fatalf("no link in %q", sent[len(sent)-1].Text)
	}
	return m[1]
}

func states(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, s := range decode[[]TopicState](t, rec) {
		out[s.Topic] = s.State
	}
	return out
}

func on(topic string) map[string]any {
	return map[string]any{"topic": topic, "on": true, "source": "settings", "wordingVersion": "2026-10-08"}
}

type consentFixture struct {
	h    *handler
	mux  http.Handler
	fake *fakeResend
	k    testKey
	tok  string
}

func newConsentFixture(t *testing.T) consentFixture {
	k := newKey(t, "ins_1")
	h, fake := testHandler(t, testDB(t), k)
	return consentFixture{h: h, mux: h.routes(), fake: fake, k: k, tok: sign(t, k, claims(nil))}
}

func TestATopicIsOnOnlyAfterTheConfirmationLinkIsUsedOnce(t *testing.T) {
	f := newConsentFixture(t)
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "off" || got["announcements"] != "off" || got["early_access"] != "off" {
		t.Fatalf("defaults: %v", got)
	}
	if got := states(t, call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))); got["newsletter"] != "pending" {
		t.Fatalf("after asking: %v", got)
	}
	sent := f.fake.emails()
	if len(sent) != 1 || sent[0].To != "ada@example.org" || f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatalf("sent %+v; nothing may reach the provider's topic before confirmation", sent)
	}
	link := lastLink(t, f.fake)
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body)
	}
	if f.fake.sub("ada@example.org", "top_news") != "opt_in" {
		t.Fatal("confirmed but not opted in at the provider")
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
		t.Fatalf("after confirming: %v", got)
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusGone {
		t.Fatalf("second use: %d", rec.Code)
	}
}

func TestAConfirmationLinkIsRefusedWhenTamperedExpiredOrStale(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("announcements"))
	link := lastLink(t, f.fake)
	if strings.Contains(link, "@") || strings.Contains(link, accountID(t, f)) {
		t.Fatalf("the link carries personal data: %s", link)
	}
	id, sig, _ := strings.Cut(link, ".")
	for name, tok := range map[string]string{
		"another request's id": "999." + sig,
		"another MAC":          id + "." + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"padded MAC":           link + "=",
		"non-canonical MAC":    noncanonical(link),
		"garbage":              "x.y",
		"empty":                "",
	} {
		if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": tok}); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	f.h.now = func() time.Time { return now.Add(linkTTL + time.Second) }
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusBadRequest {
		t.Errorf("expired: %d", rec.Code)
	}
	f.h.now = func() time.Time { return now }
	// The account's address changed: a link for the old address no longer confirms anything.
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" })), nil)
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusGone {
		t.Errorf("old address: %d", rec.Code)
	}
}

func TestTurningATopicOffReachesTheProviderFirst(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	off := map[string]any{"topic": "newsletter", "on": false}
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, off); rec.Code != http.StatusBadGateway {
		t.Fatalf("provider down: %d", rec.Code)
	}
	f.fake.setDown(false)
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
		t.Fatalf("a failed opt-out changed the state: %v", got)
	}
	if got := states(t, call(t, f.mux, "POST", "/api/account/topics", f.tok, off)); got["newsletter"] != "off" || f.fake.sub("ada@example.org", "top_news") != "opt_out" {
		t.Fatalf("opt-out: %v / %q", got, f.fake.sub("ada@example.org", "top_news"))
	}
}

func TestAConfirmDuringOptOutCannotKeepTheProviderSubscribed(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() {
		if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusOK {
			t.Errorf("concurrent confirmation: %d", rec.Code)
		}
	}
	f.fake.mu.Unlock()
	rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, map[string]any{"topic": "newsletter", "on": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("opt out: %d", rec.Code)
	}
	if got := states(t, rec); got["newsletter"] != "off" {
		t.Fatalf("local state: %v", got)
	}
	if got := f.fake.sub("ada@example.org", "top_news"); got != "opt_out" {
		t.Fatalf("successful opt-out left provider subscribed: %q", got)
	}
}

func TestOptOutReportsProviderFailureAfterWithdrawal(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() { f.fake.setDown(true) }
	f.fake.mu.Unlock()
	off := map[string]any{"topic": "newsletter", "on": false}
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, off); rec.Code != http.StatusBadGateway {
		t.Fatalf("unconfirmed provider state must not report success: %d", rec.Code)
	}
	f.fake.setDown(false)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, off); rec.Code != http.StatusOK {
		t.Fatalf("retry: %d", rec.Code)
	}
}

func TestARequestNeedsAVerifiedAddressAValidTopicAndASentEmail(t *testing.T) {
	f := newConsentFixture(t)
	unverified := sign(t, f.k, claims(func(c jwt.MapClaims) { c["sub"] = "user_2"; c["email_verified"] = false }))
	if rec := call(t, f.mux, "POST", "/api/account/topics", unverified, on("newsletter")); rec.Code != http.StatusConflict {
		t.Errorf("unverified: %d", rec.Code)
	}
	bad := []map[string]any{
		{"topic": "airdrops", "on": true, "source": "s", "wordingVersion": "v"},
		{"topic": "newsletter", "on": true, "scope": "nft", "source": "s", "wordingVersion": "v"},
		{"topic": "early_access", "on": true, "scope": "nft,casino", "source": "s", "wordingVersion": "v"},
		{"topic": "early_access", "on": true, "source": "s", "wordingVersion": "v"},
		{"topic": "newsletter", "on": true},
	}
	for _, b := range bad {
		if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, b); rec.Code != http.StatusBadRequest {
			t.Errorf("%v: %d", b, rec.Code)
		}
	}
	early := on("early_access")
	early["scope"] = "launchpad,nft"
	if got := states(t, call(t, f.mux, "POST", "/api/account/topics", f.tok, early)); got["early_access"] != "pending" {
		t.Errorf("early access: %v", got)
	}
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("announcements")); rec.Code != http.StatusBadGateway {
		t.Errorf("email not sent: %d", rec.Code)
	}
	f.fake.setDown(false)
	var n int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM consents WHERE topic = 'announcements'").Scan(&n)
	if n != 0 {
		t.Errorf("a request whose email was not sent stayed stored (%d)", n)
	}
}

func TestConfirmingANewerRequestSupersedesTheOlderOne(t *testing.T) {
	f := newConsentFixture(t)
	first := on("early_access")
	first["scope"] = "nft"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, first)
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	second := on("early_access")
	second["scope"] = "nft,launchpad"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, second)
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	all, _ := consents(t.Context(), f.h.db, accountID(t, f))
	if len(all) != 2 || all[0].WithdrawnReason != "superseded" || all[1].ConfirmedAt == "" || all[1].WithdrawnAt != "" {
		t.Fatalf("rows: %+v", all)
	}
}

func accountID(t *testing.T, f consentFixture) string {
	t.Helper()
	return decode[Account](t, call(t, f.mux, "GET", "/api/account", f.tok, nil)).ID
}

func TestExportHoldsTheConsentsAndDeleteGoesThroughTheProviderFirst(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	if got := decode[Export](t, call(t, f.mux, "GET", "/api/account/export", f.tok, nil)); len(got.Consents) != 1 || got.Consents[0].Email != "ada@example.org" {
		t.Fatalf("export: %+v", got)
	}
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("provider down: %d", rec.Code)
	}
	f.fake.setDown(false)
	var n int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&n)
	if n != 1 {
		t.Fatal("rows went before the provider's contact")
	}
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&n)
	if n != 0 || f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatalf("after delete: %d consents, contact %q", n, f.fake.sub("ada@example.org", "top_news"))
	}
}

// Each check of a confirmation link refuses on its own, even where another
// layer would also catch the same case.
func TestEveryConfirmCheckRefusesOnItsOwn(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	confirm := func(tok string) int {
		return call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": tok}).Code
	}
	// A MAC over other bound fields (here another request time) does not match the stored request.
	var b boundRequest
	b.ID = 1
	_ = f.h.db.QueryRow("SELECT account_id, topic, email FROM consents WHERE id = 1").Scan(&b.AccountID, &b.Topic, &b.Email)
	b.RequestedAt = "2026-01-01T00:00:00Z"
	if code := confirm(linkFor(f.h.linkSecret, b)); code != http.StatusBadRequest {
		t.Errorf("another request time: %d", code)
	}
	// The account's address moved without its requests being moved.
	_, _ = f.h.db.Exec("UPDATE accounts SET email = 'eve@example.org'")
	if code := confirm(link); code != http.StatusGone {
		t.Errorf("address no longer the account's: %d", code)
	}
	_, _ = f.h.db.Exec("UPDATE accounts SET email = 'ada@example.org', email_undeliverable_at = '2026-10-08T00:00:00Z'")
	if code := confirm(link); code != http.StatusGone {
		t.Errorf("undeliverable address: %d", code)
	}
	_, _ = f.h.db.Exec("UPDATE accounts SET email_undeliverable_at = NULL")
	if code := confirm(link); code != http.StatusOK {
		t.Fatalf("valid link: %d", code)
	}
	// A used link asks nothing of the provider again.
	before := len(f.fake.calls)
	if code := confirm(link); code != http.StatusGone || len(f.fake.calls) != before {
		t.Errorf("second use: %d, %d new provider calls", code, len(f.fake.calls)-before)
	}
}

func TestAnAddressChangeLetsGoOfTheOldContactFirst(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	newTok := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" }))
	f.fake.setDown(true)
	if rec := call(t, f.mux, "GET", "/api/account", newTok, nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("provider down: %d", rec.Code)
	}
	f.fake.setDown(false)
	var stored string
	_ = f.h.db.QueryRow("SELECT email FROM accounts").Scan(&stored)
	if stored != "ada@example.org" || f.fake.sub("ada@example.org", "top_news") != "opt_in" {
		t.Fatalf("nothing may change while the provider holds the old address: %q", stored)
	}
	if got := decode[Account](t, call(t, f.mux, "GET", "/api/account", newTok, nil)); got.Email != "ada@new.example" {
		t.Fatalf("retry: %+v", got)
	}
	if f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatal("the old address is still a contact")
	}
	all, _ := consents(t.Context(), f.h.db, accountID(t, consentFixture{mux: f.mux, tok: newTok}))
	if all[0].WithdrawnReason != "email_changed" {
		t.Fatalf("the old address's consent stayed live: %+v", all[0])
	}
}

func TestASessionIssuedBeforeTheChangeCannotChangeItBack(t *testing.T) {
	f := newConsentFixture(t)
	accountID(t, f)
	f.h.now = func() time.Time { return now.Add(time.Minute) }
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example"; c["iat"] = now.Add(time.Minute).Unix() })), nil)
	stale := sign(t, f.k, claims(func(c jwt.MapClaims) { c["iat"] = now.Unix() })) // still carries the old address
	if got := decode[Account](t, call(t, f.mux, "GET", "/api/account", stale, nil)); got.Email != "ada@new.example" {
		t.Fatalf("a stale session changed the address back: %+v", got)
	}
}

func TestDeleteRemovesTheContactOfEveryAddressTheAccountGave(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	// An address the account named before, whose contact the provider still holds.
	_, _ = f.h.db.Exec("INSERT INTO consents (account_id, topic, email, wording_version, source, requested_at, confirmed_at) SELECT id, 'announcements', 'old@example.org', 'v', 's', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z' FROM accounts")
	f.fake.mu.Lock()
	f.fake.contacts["old@example.org"] = map[string]string{"top_ann": "opt_in"}
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if f.fake.sub("old@example.org", "top_ann") != "" || f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatal("a contact outlived the account")
	}
}

func TestAConfirmThatFailsAfterTheOptInOptsBackOut(t *testing.T) {
	for name, trigger := range map[string]string{
		"the update fails":     "CREATE TRIGGER t BEFORE UPDATE OF confirmed_at ON consents BEGIN SELECT RAISE(ABORT, 'test'); END",
		"the update is beaten": "CREATE TRIGGER t BEFORE UPDATE OF confirmed_at ON consents BEGIN SELECT RAISE(IGNORE); END",
	} {
		t.Run(name, func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			if _, err := f.h.db.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)}); rec.Code < 400 {
				t.Fatalf("confirm: %d", rec.Code)
			}
			if f.fake.sub("ada@example.org", "top_news") != "opt_out" {
				t.Fatal("the provider kept an opt-in Memba never recorded")
			}
		})
	}
	// Another confirmed request of the topic keeps it on at the provider.
	f := newConsentFixture(t)
	first := on("early_access")
	first["scope"] = "nft"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, first)
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	second := on("early_access")
	second["scope"] = "nft,launchpad"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, second)
	_, _ = f.h.db.Exec("CREATE TRIGGER t BEFORE UPDATE OF confirmed_at ON consents BEGIN SELECT RAISE(ABORT, 'test'); END")
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	if f.fake.sub("ada@example.org", "top_early") != "opt_in" {
		t.Fatal("undoing a failed confirm removed a topic another request keeps on")
	}
}

func TestOneOpenRequestPerTopicWithACooldown(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter")); rec.Code != http.StatusTooManyRequests || len(f.fake.emails()) != 1 {
		t.Fatalf("within the cooldown: %d, %d emails", rec.Code, len(f.fake.emails()))
	}
	f.h.now = func() time.Time { return now.Add(requestCooldown + time.Second) }
	f.tok = sign(t, f.k, claims(func(c jwt.MapClaims) {
		c["iat"] = now.Add(requestCooldown).Unix()
		c["exp"] = now.Add(requestCooldown + time.Minute).Unix()
	}))
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	all, _ := consents(t.Context(), f.h.db, accountID(t, f))
	if len(f.fake.emails()) != 2 || all[0].WithdrawnReason != "superseded" || all[1].WithdrawnAt != "" {
		t.Fatalf("after the cooldown: %d emails, rows %+v", len(f.fake.emails()), all)
	}
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	if len(f.fake.emails()) != 2 {
		t.Fatal("asking again for a topic already on sent an email")
	}
}

func TestAnExpiredReRequestDoesNotHideATopicThatIsOn(t *testing.T) {
	f := newConsentFixture(t)
	first := on("early_access")
	first["scope"] = "nft"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, first)
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	second := on("early_access")
	second["scope"] = "nft,launchpad"
	call(t, f.mux, "POST", "/api/account/topics", f.tok, second)
	all, _ := consents(t.Context(), f.h.db, accountID(t, f))
	for name, at := range map[string]time.Time{"while the re-request is open": now, "after it expired": now.Add(linkTTL + time.Hour)} {
		if got := topicStates(all, at); got[2] != (TopicState{Topic: "early_access", State: "on", Scope: "nft"}) {
			t.Errorf("%s: %+v", name, got[2])
		}
	}
}

// No address may reach the logs: provider errors name the operation and status only.
func TestNoAddressReachesTheLogs(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	f.fake.setDown(true)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("announcements"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link})
	call(t, f.mux, "POST", "/api/account/topics", f.tok, map[string]any{"topic": "newsletter", "on": false})
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" })), nil)
	call(t, f.mux, "POST", "/api/account/delete", f.tok, nil)
	f.fake.srv.Close() // a transport error, whose text names the URL
	call(t, f.mux, "POST", "/api/account/delete", f.tok, nil)
	if !strings.Contains(buf.String(), "resend") || strings.Contains(buf.String(), "@") {
		t.Fatalf("logs: %s", buf.String())
	}
}

// The MAC comparisons stay constant-time.
func TestMACsAreComparedInConstantTime(t *testing.T) {
	for _, file := range []string{"link.go", "svix.go"} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(src), "hmac.Equal(") || strings.Contains(string(src), "bytes.Equal(") || strings.Contains(string(src), "string(got) ==") {
			t.Errorf("%s must compare MACs with hmac.Equal only", file)
		}
	}
}

// noncanonical re-spells a token's MAC with non-zero unused low bits in its
// last character: lenient base64 would decode the same MAC from it.
func noncanonical(link string) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, link[len(link)-1])
	return link[:len(link)-1] + string(alphabet[last|1])
}

// A confirmation landing after the old contact is deleted but before the
// address change commits re-creates the contact: it is deleted again.
func TestAConfirmInTheAddressChangeWindowLeavesNoContact(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	f.fake.afterDelete = func() {
		if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusOK {
			t.Errorf("confirm in the window: %d", rec.Code)
		}
	}
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" })), nil)
	if f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatal("the old address kept a contact the account no longer has")
	}
	var reason string
	_ = f.h.db.QueryRow("SELECT withdrawn_reason FROM consents WHERE id = 1").Scan(&reason)
	if reason != "email_changed" {
		t.Fatalf("withdrawn reason %q", reason)
	}
}

// The same window in account deletion.
func TestAConfirmInTheDeleteWindowLeavesNoContact(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("announcements"))
	link := lastLink(t, f.fake)
	f.fake.afterDelete = func() { call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}) }
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if f.fake.sub("ada@example.org", "top_ann") != "" {
		t.Fatal("a contact outlived the account")
	}
}

// An opt-in that failed after it was applied is undone.
func TestAnOptInThatFailedAfterItWasAppliedIsUndone(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{}
	f.fake.applyThenFail = true
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)}); rec.Code != http.StatusBadGateway {
		t.Fatalf("confirm: %d", rec.Code)
	}
	if f.fake.sub("ada@example.org", "top_news") != "opt_out" {
		t.Fatal("a failed opt-in stayed applied at the provider")
	}
}

// Undoing an opt-in fails closed and outlives a cancelled request.
func TestUndoingAnOptInFailsClosedAndOutlivesTheRequest(t *testing.T) {
	f := newConsentFixture(t)
	id := accountID(t, f)
	b := boundRequest{AccountID: id, Topic: "newsletter", Email: "ada@example.org"}
	set := func(sub string) {
		f.fake.mu.Lock()
		f.fake.contacts["ada@example.org"] = map[string]string{"top_news": sub}
		f.fake.mu.Unlock()
	}
	set("opt_in")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := f.h.undoOptIn(ctx, b); err != nil {
		t.Fatal(err)
	}
	if f.fake.sub("ada@example.org", "top_news") != "opt_out" {
		t.Fatal("a cancelled request skipped the undo")
	}
	set("opt_in")
	_ = f.h.db.Close()
	if err := f.h.undoOptIn(t.Context(), b); err != nil {
		t.Fatal(err)
	}
	if f.fake.sub("ada@example.org", "top_news") != "opt_out" {
		t.Fatal("an unreadable database kept the opt-in")
	}
}

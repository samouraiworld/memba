package account

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestAnAddressChangeAsksTheNewAddressToConfirmAgain(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" })), nil)
	newTok := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" }))
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", newTok, nil)); got["newsletter"] != "pending" {
		t.Fatalf("after the change: %v", got)
	}
	sent := f.fake.emails()
	if sent[len(sent)-1].To != "ada@new.example" || f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatalf("the new address must be asked, the old contact removed: %+v", sent)
	}
	all, _ := consents(t.Context(), f.h.db, accountID(t, consentFixture{mux: f.mux, tok: newTok}))
	if all[0].WithdrawnReason != "email_changed" || all[1].Email != "ada@new.example" || all[1].Source != "email_changed" {
		t.Fatalf("rows: %+v", all)
	}
	// Losing verification withdraws and asks nobody.
	before := len(f.fake.emails())
	call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example"; c["email_verified"] = false })), nil)
	if len(f.fake.emails()) != before {
		t.Fatal("an email went to an unverified address")
	}
}

func signedWebhook(t *testing.T, f consentFixture, id string, body []byte, at time.Time, extraSigs ...string) []string {
	t.Helper()
	key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(testConfig(t, f.k).ResendWebhookSecret, "whsec_"))
	ts := fmt.Sprint(at.Unix())
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + ts + "."))
	mac.Write(body)
	sigs := append(extraSigs, "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return []string{"svix-id", id, "svix-timestamp", ts, "svix-signature", strings.Join(sigs, " ")}
}

func TestTheWebhookCanOnlyWithdrawAndAppliesEachDeliveryOnce(t *testing.T) {
	f := newConsentFixture(t)
	for _, topic := range []string{"newsletter", "announcements"} {
		call(t, f.mux, "POST", "/api/account/topics", f.tok, on(topic))
		call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	}
	early := on("early_access")
	early["scope"] = "nft"
	if got := states(t, call(t, f.mux, "POST", "/api/account/topics", f.tok, early)); got["early_access"] != "pending" { // no event may confirm it
		t.Fatalf("early access: %v", got)
	}
	hook := func(id string, body []byte, at time.Time, extra ...string) int {
		return call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, id, body, at, extra...)...).Code
	}
	stateOf := func() map[string]string { return states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)) }

	optOut := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"]["top_news"] = "opt_out"
	f.fake.mu.Unlock()
	if code := hook("msg_1", optOut, now, "v1,bm90IGl0"); code != http.StatusNoContent {
		t.Fatalf("topic opt-out (second of two signatures valid): %d", code)
	}
	if got := stateOf(); got["newsletter"] != "off" || got["announcements"] != "on" || got["early_access"] != "pending" {
		t.Fatalf("after a topic opt-out: %v", got)
	}
	// Bad signature, stale or future timestamp: refused.
	headers := signedWebhook(t, f, "msg_2", optOut, now)
	headers[5] = "v1,AAAA"
	if code := call(t, f.mux, "POST", "/api/webhooks/resend", "", optOut, headers...).Code; code != http.StatusUnauthorized {
		t.Errorf("bad signature: %d", code)
	}
	for _, at := range []time.Time{now.Add(-6 * time.Minute), now.Add(6 * time.Minute)} {
		if code := hook("msg_3", optOut, at); code != http.StatusUnauthorized {
			t.Errorf("timestamp %v: %d", at, code)
		}
	}
	// A permanent bounce marks the address undeliverable and withdraws the rest; a replay changes nothing.
	bounce := []byte(`{"type":"email.bounced","data":{"to":["ada@example.org"],"bounce":{"type":"Permanent"}}}`)
	if code := hook("msg_4", bounce, now); code != http.StatusNoContent {
		t.Fatalf("bounce: %d", code)
	}
	if got := stateOf(); got["announcements"] != "off" || got["early_access"] != "off" {
		t.Fatalf("after a bounce: %v", got)
	}
	if !decode[Account](t, call(t, f.mux, "GET", "/api/account", f.tok, nil)).EmailUndeliverable {
		t.Fatal("bounce did not mark the address")
	}
	var n int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events").Scan(&n)
	hook("msg_4", bounce, now)
	var after int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events").Scan(&after)
	if after != n {
		t.Fatal("a replay was recorded twice")
	}
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter")); rec.Code != http.StatusConflict {
		t.Errorf("asking for an undeliverable address: %d", rec.Code)
	}
}

func TestAWebhookWhoseUpdateFailsIsNotRecordedAndCanBeRetried(t *testing.T) {
	f := newConsentFixture(t)
	accountID(t, f)
	if _, err := f.h.db.Exec("CREATE TRIGGER fail_bounce BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'test'); END"); err != nil {
		t.Fatal(err)
	}
	bounce := []byte(`{"type":"email.complained","data":{"to":["ada@example.org"]}}`)
	headers := signedWebhook(t, f, "msg_9", bounce, now)
	if code := call(t, f.mux, "POST", "/api/webhooks/resend", "", bounce, headers...).Code; code != http.StatusInternalServerError {
		t.Fatalf("failing update: %d", code)
	}
	var n int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id = 'msg_9'").Scan(&n)
	if n != 0 {
		t.Fatal("a delivery whose update failed was recorded as applied")
	}
	_, _ = f.h.db.Exec("DROP TRIGGER fail_bounce")
	if code := call(t, f.mux, "POST", "/api/webhooks/resend", "", bounce, headers...).Code; code != http.StatusNoContent {
		t.Fatalf("retry: %d", code)
	}
	if !decode[Account](t, call(t, f.mux, "GET", "/api/account", f.tok, nil)).EmailUndeliverable {
		t.Fatal("complaint not applied on retry")
	}
	big := bytes.Repeat([]byte("x"), 64<<10+1)
	if code := call(t, f.mux, "POST", "/api/webhooks/resend", "", big, signedWebhook(t, f, "msg_10", big, now)...).Code; code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: %d", code)
	}
}

func TestATemporaryBounceChangesNothing(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	soft := []byte(`{"type":"email.bounced","data":{"to":["ada@example.org"],"bounce":{"type":"Temporary"}}}`)
	call(t, f.mux, "POST", "/api/webhooks/resend", "", soft, signedWebhook(t, f, "msg_t", soft, now)...)
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
		t.Fatalf("temporary bounce withdrew: %v", got)
	}
}

func TestTheSweepRemovesOnlyUnconfirmedRequestsAndOldDeliveries(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("announcements"))
	_, _ = f.h.db.Exec("INSERT INTO webhook_events (id, received_at) VALUES ('old', '2026-01-01T00:00:00Z'), ('new', ?)", now.Add(linkTTL).UTC().Format(time.RFC3339))
	if err := sweep(t.Context(), f.h.db, now.Add(linkTTL+time.Hour)); err != nil {
		t.Fatal(err)
	}
	var topics []string
	rows, _ := f.h.db.Query("SELECT topic FROM consents")
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		topics = append(topics, s)
	}
	_ = rows.Close()
	var events int
	_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events").Scan(&events)
	if fmt.Sprint(topics) != "[newsletter]" || events != 1 {
		t.Fatalf("left %v and %d deliveries", topics, events)
	}
}

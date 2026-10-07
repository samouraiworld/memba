package account

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

type testKey struct {
	kid string
	key *rsa.PrivateKey
	pem string
}

func newKey(t *testing.T, kid string) testKey {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&k.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return testKey{kid: kid, key: k, pem: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))}
}

func keysJSON(t *testing.T, ks ...testKey) string {
	t.Helper()
	m := map[string]string{}
	for _, k := range ks {
		m[k.kid] = k.pem
	}
	b, _ := json.Marshal(m)
	return string(b)
}

// claims are a valid Clerk session for subject user_1 unless a test changes them.
func claims(edit func(jwt.MapClaims)) jwt.MapClaims {
	c := jwt.MapClaims{
		"iss": Issuer, "azp": AuthorizedParty, "sub": "user_1",
		"exp": now.Add(time.Minute).Unix(), "iat": now.Unix(), "nbf": now.Add(-time.Second).Unix(),
		"email": "ada@example.org", "email_verified": true,
	}
	if edit != nil {
		edit(c)
	}
	return c
}

func sign(t *testing.T, k testKey, c jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	tok.Header["kid"] = k.kid
	s, err := tok.SignedString(k.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func verifier(t *testing.T, ks ...testKey) *Verifier {
	t.Helper()
	keys, err := ParseKeys(keysJSON(t, ks...))
	if err != nil {
		t.Fatal(err)
	}
	v := NewVerifier(keys)
	v.now = func() time.Time { return now }
	return v
}

func TestVerifyAcceptsAClerkSessionAndReadsOnlyAVerifiedEmail(t *testing.T) {
	k := newKey(t, "ins_1")
	v := verifier(t, k)
	got, err := v.Verify(sign(t, k, claims(nil)))
	if err != nil || got != (Claims{Subject: "user_1", Email: "ada@example.org"}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	for name, verified := range map[string]any{"false": false, "string true": "true", "missing": nil} {
		got, err := v.Verify(sign(t, k, claims(func(c jwt.MapClaims) {
			if verified == nil {
				delete(c, "email_verified")
			} else {
				c["email_verified"] = verified
			}
		})))
		if err != nil || got.Email != "" {
			t.Errorf("%s: email %q kept (err %v)", name, got.Email, err)
		}
	}
}

func TestVerifyRefusesForgedMalformedAndForeignTokens(t *testing.T) {
	k, other := newKey(t, "ins_1"), newKey(t, "ins_2")
	v := verifier(t, k)

	hmac := jwt.NewWithClaims(jwt.SigningMethodHS256, claims(nil))
	hmac.Header["kid"] = k.kid
	hmacWithPEM, _ := hmac.SignedString([]byte(k.pem))
	none := jwt.NewWithClaims(jwt.SigningMethodNone, claims(nil))
	none.Header["kid"] = k.kid
	unsigned, _ := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	wrongKey := sign(t, testKey{kid: k.kid, key: other.key}, claims(nil))
	rs512 := jwt.NewWithClaims(jwt.SigningMethodRS512, claims(nil))
	rs512.Header["kid"] = k.kid
	rs512Signed, _ := rs512.SignedString(k.key)
	crit := jwt.NewWithClaims(jwt.SigningMethodRS256, claims(nil))
	crit.Header["kid"] = k.kid
	crit.Header["crit"] = []string{"exp"}
	critical, _ := crit.SignedString(k.key)

	cases := map[string]string{
		"HS256 signed with the public PEM": hmacWithPEM,
		"alg none":                         unsigned,
		"signed by another key":            wrongKey,
		"unknown kid":                      sign(t, other, claims(nil)),
		"unlisted kid, listed key":         sign(t, testKey{kid: "ins_unlisted", key: k.key}, claims(nil)),
		"RS512 by the instance key":        rs512Signed,
		"no exp":                           sign(t, k, claims(func(c jwt.MapClaims) { delete(c, "exp") })),
		"expired past the leeway":          sign(t, k, claims(func(c jwt.MapClaims) { c["exp"] = now.Add(-6 * time.Second).Unix() })),
		"not yet valid":                    sign(t, k, claims(func(c jwt.MapClaims) { c["nbf"] = now.Add(time.Minute).Unix() })),
		"another issuer":                   sign(t, k, claims(func(c jwt.MapClaims) { c["iss"] = "https://clerk.example.org" })),
		"no azp":                           sign(t, k, claims(func(c jwt.MapClaims) { delete(c, "azp") })),
		"another azp":                      sign(t, k, claims(func(c jwt.MapClaims) { c["azp"] = "https://evil.example" })),
		"empty sub":                        sign(t, k, claims(func(c jwt.MapClaims) { c["sub"] = "" })),
		"whitespace sub":                   sign(t, k, claims(func(c jwt.MapClaims) { c["sub"] = " \t" })),
		"critical header":                  critical,
		"garbage":                          "not.a.jwt",
		"tampered payload":                 tamper(sign(t, k, claims(nil))),
	}
	for name, tok := range cases {
		if got, err := v.Verify(tok); err == nil {
			t.Errorf("%s: accepted as %+v", name, got)
		}
	}
	// Within the leeway, a just-expired token still counts (clock skew).
	if _, err := v.Verify(sign(t, k, claims(func(c jwt.MapClaims) { c["exp"] = now.Add(-3 * time.Second).Unix() }))); err != nil {
		t.Errorf("token 3 s past exp refused: %v", err)
	}
}

func tamper(tok string) string {
	parts := strings.Split(tok, ".")
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(payload), "user_1", "user_2", 1)))
	return strings.Join(parts, ".")
}

func TestVerifySelectsTheKeyByKidDuringARotation(t *testing.T) {
	oldKey, newer := newKey(t, "ins_old"), newKey(t, "ins_new")
	v := verifier(t, oldKey, newer)
	for _, k := range []testKey{oldKey, newer} {
		if _, err := v.Verify(sign(t, k, claims(nil))); err != nil {
			t.Errorf("%s refused: %v", k.kid, err)
		}
	}
}

func TestParseKeysRefusesUnusableConfiguration(t *testing.T) {
	k := newKey(t, "ins_1")
	for name, raw := range map[string]string{
		"empty":     "",
		"not JSON":  k.pem,
		"no key":    "{}",
		"not a PEM": `{"ins_1":"nope"}`,
		"empty kid": keysJSON(t, testKey{kid: "", pem: k.pem}),
	} {
		if _, err := ParseKeys(raw); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

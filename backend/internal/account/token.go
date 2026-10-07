// Package account is the optional Memba account: an identity-provider session
// (Clerk) verified without network calls, and the rows Memba keeps for it.
// Wallet tokens stay as they are for everything on chain.
package account

import (
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// Issuer is the Clerk instance's frontend API (its primary domain).
	Issuer = "https://clerk.memba.club"
	// AuthorizedParty is the only origin whose sessions this backend accepts.
	AuthorizedParty = "https://memba.club"
	// leeway absorbs clock skew between Clerk and this host.
	leeway = 5 * time.Second
)

// ErrToken is any rejected session token: the caller answers 401.
var ErrToken = errors.New("invalid session token")

// Claims is what Memba reads from a verified session.
type Claims struct {
	Subject string
	// Email is set only when the provider reports it verified.
	Email string
}

// Verifier checks Clerk session JWTs against the instance's public keys,
// selected by the token's kid (several during a rotation).
type Verifier struct {
	keys map[string]*rsa.PublicKey
	now  func() time.Time
}

// ParseKeys reads CLERK_JWT_KEYS: a JSON object {kid: PEM public key}.
func ParseKeys(raw string) (map[string]*rsa.PublicKey, error) {
	var pems map[string]string
	if err := json.Unmarshal([]byte(raw), &pems); err != nil {
		return nil, fmt.Errorf("CLERK_JWT_KEYS is not a JSON object: %w", err)
	}
	if len(pems) == 0 {
		return nil, errors.New("CLERK_JWT_KEYS holds no key")
	}
	keys := make(map[string]*rsa.PublicKey, len(pems))
	for kid, pem := range pems {
		key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(pem))
		if err != nil || kid == "" {
			return nil, fmt.Errorf("CLERK_JWT_KEYS: key %q is not an RSA public key", kid)
		}
		keys[kid] = key
	}
	return keys, nil
}

// NewVerifier verifies with the given keys.
func NewVerifier(keys map[string]*rsa.PublicKey) *Verifier {
	return &Verifier{keys: keys, now: time.Now}
}

type sessionClaims struct {
	jwt.RegisteredClaims
	AuthorizedParty string `json:"azp"`
	Email           string `json:"email"`
	// Raw so that only the JSON boolean true counts (never the string "true").
	EmailVerified json.RawMessage `json:"email_verified"`
}

// Verify returns the session's claims, or ErrToken.
func (v *Verifier) Verify(token string) (Claims, error) {
	var c sessionClaims
	_, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		// RFC 7515 §4.1.11: critical extensions this verifier does not know must be refused.
		if _, ok := t.Header["crit"]; ok {
			return nil, errors.New("critical header")
		}
		kid, _ := t.Header["kid"].(string)
		key, ok := v.keys[kid]
		if !ok {
			return nil, errors.New("unknown kid")
		}
		return key, nil
	},
		// RS256 only: a token HMAC-signed with the public PEM as its secret must fail.
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(Issuer),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(leeway),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil || strings.TrimSpace(c.Subject) == "" || c.AuthorizedParty != AuthorizedParty {
		return Claims{}, ErrToken
	}
	out := Claims{Subject: c.Subject}
	if string(c.EmailVerified) == "true" {
		out.Email = c.Email
	}
	return out, nil
}

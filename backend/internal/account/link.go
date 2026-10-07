package account

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
)

// linkTTL is how long a confirmation link stays usable.
const linkTTL = 7 * 24 * time.Hour

// boundRequest is what a confirmation link is bound to: the stored request.
// The link carries only the request's id and a MAC over these fields, so no
// address or account id travels in the URL (where logs, analytics and
// referrers would see it); verifying reads the row and recomputes the MAC.
type boundRequest struct {
	ID          int64
	AccountID   string
	Topic       string
	Email       string
	RequestedAt string
}

var errLink = errors.New("invalid or expired link")

func (b boundRequest) mac(secret []byte) []byte {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("memba-consent-link\x00" + strconv.FormatInt(b.ID, 10) + "\x00" + b.AccountID + "\x00" + b.Topic + "\x00" + b.Email + "\x00" + b.RequestedAt))
	return m.Sum(nil)
}

// linkFor is the token of a confirmation link: "<id>.<mac>".
func linkFor(secret []byte, b boundRequest) string {
	return strconv.FormatInt(b.ID, 10) + "." + base64.RawURLEncoding.EncodeToString(b.mac(secret))
}

// parseLink splits a token into the request id it names and its MAC.
func parseLink(token string) (int64, []byte, error) {
	id, sig, ok := strings.Cut(token, ".")
	n, err := strconv.ParseInt(id, 10, 64)
	if !ok || err != nil || n <= 0 {
		return 0, nil, errLink
	}
	mac, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil {
		return 0, nil, errLink
	}
	return n, mac, nil
}

// issuedFor tells, in constant time, whether mac was issued for the stored request b.
func (b boundRequest) issuedFor(secret, mac []byte) bool {
	return hmac.Equal(mac, b.mac(secret))
}

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

// svixTolerance bounds how old (or early) a signed webhook may be.
const svixTolerance = 5 * time.Minute

// verifySvix checks a Svix-signed webhook (Resend): the HMAC-SHA256 of
// "<id>.<timestamp>.<body>" under the decoded whsec_ secret must equal one of the
// space-separated "v1,<base64>" signatures, and the timestamp must be recent.
func verifySvix(key []byte, id, timestamp, signatures string, body []byte, now time.Time) error {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || id == "" {
		return errors.New("missing webhook headers")
	}
	if d := now.Sub(time.Unix(ts, 0)); d > svixTolerance || d < -svixTolerance {
		return errors.New("webhook timestamp out of range")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(body)
	want := mac.Sum(nil)
	for _, sig := range strings.Fields(signatures) {
		version, value, ok := strings.Cut(sig, ",")
		if !ok || version != "v1" {
			continue
		}
		got, err := base64.StdEncoding.Strict().DecodeString(value)
		if err == nil && hmac.Equal(got, want) {
			return nil
		}
	}
	return errors.New("no valid webhook signature")
}

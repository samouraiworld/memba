package siwe

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// Produced by viem 2.57.3 createSiweMessage (the formatter the frontend uses),
// so the parser is checked against the real client output, not only our own.
const (
	viemWithStatement = "memba.club wants you to sign in with your Ethereum account:\n" +
		"0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf\n\n" +
		"Sign in to Memba.\n\n" +
		"URI: https://memba.club\nVersion: 1\nChain ID: 8453\n" +
		"Nonce: 0123456789abcdef0123456789abcdef\n" +
		"Issued At: 2026-10-07T12:00:00.000Z\nExpiration Time: 2026-10-07T12:10:00.000Z"
	viemWithoutStatement = "deploy-preview-12--membaos.netlify.app wants you to sign in with your Ethereum account:\n" +
		"0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf\n\n\n" +
		"URI: https://deploy-preview-12--membaos.netlify.app\nVersion: 1\nChain ID: 84532\n" +
		"Nonce: abcdef0123456789\nIssued At: 2026-10-07T12:00:00.000Z"
	// The example message of EIP-4361 itself (resources, no expiry).
	eipExample = "example.com wants you to sign in with your Ethereum account:\n" +
		"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n\n" +
		"I accept the ExampleOrg Terms of Service: https://example.com/tos\n\n" +
		"URI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: 32891756\n" +
		"Issued At: 2021-09-30T16:25:24Z\nResources:\n" +
		"- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/\n" +
		"- https://example.com/my-web2-claim.json"
	// Every optional field, plus a scheme.
	allFields = "https://memba.club:8443 wants you to sign in with your Ethereum account:\n" +
		"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf\n\n" +
		"Sign in.\n\n" +
		"URI: https://memba.club:8443/login?x=1#y\nVersion: 1\nChain ID: 84532\n" +
		"Nonce: ABCDEFGH12345678\nIssued At: 2026-10-07T12:00:00+02:00\n" +
		"Expiration Time: 2026-10-07T12:10:00.5Z\nNot Before: 2026-10-07T11:59:00Z\n" +
		"Request ID: req-1:%41@x\nResources:\n- https://memba.club/r"
)

func TestParseValid(t *testing.T) {
	for name, s := range map[string]string{
		"viem with statement": viemWithStatement, "viem without statement": viemWithoutStatement,
		"eip example": eipExample, "all fields": allFields,
	} {
		t.Run(name, func(t *testing.T) {
			m, err := Parse(s)
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			if got := Format(m); got != s {
				t.Fatalf("Format(Parse(s)) != s:\n%q\n%q", got, s)
			}
		})
	}

	m, err := Parse(viemWithStatement)
	if err != nil {
		t.Fatal(err)
	}
	if m.Domain != "memba.club" || m.Scheme != "" || m.URI != "https://memba.club" || m.ChainID != 8453 ||
		m.Nonce != "0123456789abcdef0123456789abcdef" || m.Statement == nil || *m.Statement != "Sign in to Memba." ||
		m.AddrText != "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf" || m.NotBefore != nil || m.RequestID != nil {
		t.Fatalf("fields: %+v", m)
	}
	if !m.IssuedAt.Equal(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)) ||
		m.ExpirationTime == nil || !m.ExpirationTime.Equal(time.Date(2026, 10, 7, 12, 10, 0, 0, time.UTC)) {
		t.Fatalf("times: %v %v", m.IssuedAt, m.ExpirationTime)
	}

	m, err = Parse(allFields)
	if err != nil {
		t.Fatal(err)
	}
	if m.Scheme != "https" || m.Domain != "memba.club:8443" || m.NotBefore == nil || m.RequestID == nil ||
		*m.RequestID != "req-1:%41@x" || len(m.Resources) != 1 {
		t.Fatalf("fields: %+v", m)
	}
}

func TestParseRejects(t *testing.T) {
	base := viemWithStatement
	cases := map[string]string{
		"empty":                   "",
		"too long":                base + strings.Repeat("x", MaxMessageBytes),
		"CRLF":                    strings.ReplaceAll(base, "\n", "\r\n"),
		"trailing newline":        base + "\n",
		"non-ascii statement":     strings.Replace(base, "Sign in to Memba.", "Sign in to Membä.", 1),
		"tab":                     strings.Replace(base, "Sign in", "Sign\tin", 1),
		"bad header":              strings.Replace(base, "wants you to sign in", "wants you to log in", 1),
		"userinfo domain":         strings.Replace(base, "memba.club wants", "memba.club@evil.com wants", 1),
		"space in domain":         strings.Replace(base, "memba.club wants", "memba .club wants", 1),
		"port zero":               strings.Replace(base, "memba.club wants", "memba.club:0 wants", 1),
		"port too big":            strings.Replace(base, "memba.club wants", "memba.club:65536 wants", 1),
		"bad scheme":              strings.Replace(base, "memba.club wants", "1https://memba.club wants", 1),
		"bad checksum":            strings.Replace(base, "0x7E5F", "0x7e5F", 1),
		"short address":           strings.Replace(base, "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", "0x7E5F", 1),
		"missing blank":           strings.Replace(base, "Bdf\n\nSign", "Bdf\nSign", 1),
		"empty statement line":    strings.Replace(viemWithoutStatement, "\n\n\nURI", "\n\n\n\nURI", 1),
		"no blank after stmt":     strings.Replace(base, "Memba.\n\nURI", "Memba.\nURI", 1),
		"statement bad char":      strings.Replace(base, "Sign in to Memba.", "Sign in <to> Memba.", 1),
		"missing URI":             strings.Replace(base, "URI: https://memba.club\n", "", 1),
		"relative URI":            strings.Replace(base, "URI: https://memba.club", "URI: /login", 1),
		"URI with space":          strings.Replace(base, "URI: https://memba.club", "URI: https://memba.club/a b", 1),
		"URI bad percent":         strings.Replace(base, "URI: https://memba.club", "URI: https://memba.club/%zz", 1),
		"version 2":               strings.Replace(base, "Version: 1", "Version: 2", 1),
		"chain leading zero":      strings.Replace(base, "Chain ID: 8453", "Chain ID: 08453", 1),
		"chain zero":              strings.Replace(base, "Chain ID: 8453", "Chain ID: 0", 1),
		"chain hex":               strings.Replace(base, "Chain ID: 8453", "Chain ID: 0x2105", 1),
		"chain overflow":          strings.Replace(base, "Chain ID: 8453", "Chain ID: 18446744073709551616", 1),
		"short nonce":             strings.Replace(base, "Nonce: 0123456789abcdef0123456789abcdef", "Nonce: 1234567", 1),
		"nonce symbol":            strings.Replace(base, "Nonce: 0123456789abcdef", "Nonce: 0123456789abcde-", 1),
		"nonce too long":          strings.Replace(base, "Nonce: 0123456789abcdef", "Nonce: "+strings.Repeat("a", maxNonceLen+1), 1),
		"issued at date only":     strings.Replace(base, "Issued At: 2026-10-07T12:00:00.000Z", "Issued At: 2026-10-07", 1),
		"issued at lowercase t":   strings.Replace(base, "2026-10-07T12:00:00.000Z\nExp", "2026-10-07t12:00:00.000Z\nExp", 1),
		"issued at month 13":      strings.Replace(base, "Issued At: 2026-10-07", "Issued At: 2026-13-07", 1),
		"fields out of order":     strings.Replace(base, "Version: 1\nChain ID: 8453", "Chain ID: 8453\nVersion: 1", 1),
		"duplicate expiration":    base + "\nExpiration Time: 2026-10-07T12:10:00.000Z",
		"optional out of order":   strings.Replace(allFields, "Expiration Time: 2026-10-07T12:10:00.5Z\nNot Before: 2026-10-07T11:59:00Z", "Not Before: 2026-10-07T11:59:00Z\nExpiration Time: 2026-10-07T12:10:00.5Z", 1),
		"unknown field":           base + "\nFoo: bar",
		"empty resources":         base + "\nResources:",
		"resource not a URI":      base + "\nResources:\n- not a uri",
		"request id bad char":     strings.Replace(allFields, "Request ID: req-1", "Request ID: req 1", 1),
		"trailing after resource": eipExample + "\nfoo",
	}
	for name, s := range cases {
		t.Run(name, func(t *testing.T) {
			m, err := Parse(s)
			if err == nil {
				t.Fatalf("accepted: %+v", m)
			}
			if !errors.Is(err, ErrSyntax) && !errors.Is(err, ErrTooLong) {
				t.Fatalf("unexpected error type: %v", err)
			}
		})
	}
}

func FuzzParse(f *testing.F) {
	for _, s := range []string{viemWithStatement, viemWithoutStatement, eipExample, allFields, ""} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		m, err := Parse(s)
		if err != nil {
			if m != nil {
				t.Fatal("non-nil message with an error")
			}
			return
		}
		// One spelling per message: what was parsed is exactly what is hashed.
		if got := Format(m); got != s {
			t.Fatalf("Format(Parse(s)) != s:\n%q\n%q", got, s)
		}
		if m.Version != "1" || m.ChainID == 0 || len(m.Nonce) < 8 || m.Domain == "" || m.URI == "" {
			t.Fatalf("accepted an incomplete message: %+v", m)
		}
		if strings.ContainsAny(m.Domain, "@/ ") {
			t.Fatalf("domain %q", m.Domain)
		}
	})
}

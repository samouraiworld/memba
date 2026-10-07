// Package siwe parses Sign-In with Ethereum (EIP-4361) messages strictly and
// verifies EOA signatures over them (EIP-191 personal_sign + ecrecover).
//
// The parser accepts exactly the ABNF of EIP-4361 and nothing else: one
// textual form per message, so Format(Parse(s)) == s for every accepted s.
// That property is what lets the backend reason about the signed bytes and the
// parsed fields as the same thing. It does not decide whether a message is
// acceptable for a login (domain, nonce, chain, time window): that binding is
// the caller's, against the challenge the server issued.
//
// Contract-account signatures (EIP-1271 / ERC-6492) need the chain and live
// elsewhere; this package never touches the network.
package siwe

import (
	"strconv"
	"strings"
	"time"
)

// MaxMessageBytes bounds the message the parser will look at. A real SIWE
// message is a few hundred bytes; anything larger is refused before parsing.
const MaxMessageBytes = 4096

// Message is a parsed EIP-4361 message. Optional fields are nil (or empty for
// Scheme and Resources) when absent. The *Text fields keep the exact spelling
// that was signed, so Format reproduces the original bytes.
type Message struct {
	Scheme    string // "" when the message has no "scheme://" prefix
	Domain    string // RFC 3986 authority (host[:port], no userinfo)
	Address   [20]byte
	AddrText  string // the address exactly as written (EIP-55 or single-case)
	Statement *string
	URI       string
	Version   string // always "1"
	ChainID   uint64
	Nonce     string

	IssuedAt           time.Time
	IssuedAtText       string
	ExpirationTime     *time.Time
	ExpirationTimeText string
	NotBefore          *time.Time
	NotBeforeText      string
	RequestID          *string
	Resources          []string
}

const (
	headerSuffix   = " wants you to sign in with your Ethereum account:"
	tagURI         = "URI: "
	tagVersion     = "Version: "
	tagChainID     = "Chain ID: "
	tagNonce       = "Nonce: "
	tagIssuedAt    = "Issued At: "
	tagExpiration  = "Expiration Time: "
	tagNotBefore   = "Not Before: "
	tagRequestID   = "Request ID: "
	tagResources   = "Resources:"
	resourcePrefix = "- "
)

// Format renders m in the EIP-4361 layout. For a parsed message it returns the
// exact bytes that were parsed.
func Format(m *Message) string {
	var b strings.Builder
	if m.Scheme != "" {
		b.WriteString(m.Scheme)
		b.WriteString("://")
	}
	b.WriteString(m.Domain)
	b.WriteString(headerSuffix)
	b.WriteByte('\n')
	b.WriteString(m.AddrText)
	b.WriteString("\n\n")
	if m.Statement != nil {
		b.WriteString(*m.Statement)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	b.WriteString(tagURI + m.URI + "\n")
	b.WriteString(tagVersion + m.Version + "\n")
	b.WriteString(tagChainID + strconv.FormatUint(m.ChainID, 10) + "\n")
	b.WriteString(tagNonce + m.Nonce + "\n")
	b.WriteString(tagIssuedAt + m.IssuedAtText)
	if m.ExpirationTime != nil {
		b.WriteString("\n" + tagExpiration + m.ExpirationTimeText)
	}
	if m.NotBefore != nil {
		b.WriteString("\n" + tagNotBefore + m.NotBeforeText)
	}
	if m.RequestID != nil {
		b.WriteString("\n" + tagRequestID + *m.RequestID)
	}
	if len(m.Resources) > 0 {
		b.WriteString("\n" + tagResources)
		for _, r := range m.Resources {
			b.WriteString("\n" + resourcePrefix + r)
		}
	}
	return b.String()
}

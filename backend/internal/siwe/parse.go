package siwe

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/address"
)

var (
	// ErrTooLong is returned for a message over MaxMessageBytes.
	ErrTooLong = errors.New("siwe: message too long")
	// ErrSyntax is returned (wrapped, naming the field) for any message that
	// does not follow the EIP-4361 ABNF exactly.
	ErrSyntax = errors.New("siwe: malformed message")
)

const (
	maxNonceLen    = 128
	maxResources   = 16
	maxStatementSz = 512
)

var (
	// RFC 3339 date-time, as EIP-4361 requires: full-date "T" full-time.
	dateTimeRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$`)
	schemeRe   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*$`)
	// host[:port]: dot-separated DNS labels (an IPv4 literal also matches).
	// Userinfo ("user@host") and IP-literals are refused on purpose: they only
	// serve to make a domain look like another one.
	domainRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(:[0-9]{1,5})?$`)
	nonceRe    = regexp.MustCompile(`^[A-Za-z0-9]{8,}$`)
)

// Parse parses an EIP-4361 message. It refuses anything the ABNF does not
// produce, plus three narrowings: no userinfo or IP-literal in the domain, a
// "Resources:" section must list at least one resource, and the statement,
// when present, is not empty. Each narrowing only removes a second spelling
// of a message, keeping Format(Parse(s)) == s.
func Parse(s string) (*Message, error) {
	if len(s) > MaxMessageBytes {
		return nil, ErrTooLong
	}
	for i := 0; i < len(s); i++ {
		if c := s[i]; c != '\n' && (c < 0x20 || c > 0x7e) {
			return nil, syntaxErr("character")
		}
	}
	p := &lineReader{lines: strings.Split(s, "\n")}
	m := &Message{Version: "1"}

	header, ok := p.next()
	if !ok || !strings.HasSuffix(header, headerSuffix) {
		return nil, syntaxErr("header")
	}
	origin := strings.TrimSuffix(header, headerSuffix)
	if scheme, domain, found := strings.Cut(origin, "://"); found {
		if !schemeRe.MatchString(scheme) {
			return nil, syntaxErr("scheme")
		}
		m.Scheme, origin = scheme, domain
	}
	if !validDomain(origin) {
		return nil, syntaxErr("domain")
	}
	m.Domain = origin

	addrLine, _ := p.next()
	a, err := address.ParseEVM(addrLine)
	if err != nil {
		return nil, syntaxErr("address")
	}
	m.Address, m.AddrText = a, addrLine

	if l, _ := p.next(); l != "" {
		return nil, syntaxErr("blank line after address")
	}
	stmt, _ := p.next()
	if stmt != "" {
		if !validStatement(stmt) {
			return nil, syntaxErr("statement")
		}
		m.Statement = &stmt
		if l, _ := p.next(); l != "" {
			return nil, syntaxErr("blank line after statement")
		}
	}

	if m.URI, ok = p.tagged(tagURI); !ok || !validURI(m.URI) {
		return nil, syntaxErr("URI")
	}
	if v, ok := p.tagged(tagVersion); !ok || v != "1" {
		return nil, syntaxErr("version")
	}
	cid, ok := p.tagged(tagChainID)
	if !ok {
		return nil, syntaxErr("chain id")
	}
	if m.ChainID, err = parseChainID(cid); err != nil {
		return nil, err
	}
	if m.Nonce, ok = p.tagged(tagNonce); !ok || len(m.Nonce) > maxNonceLen || !nonceRe.MatchString(m.Nonce) {
		return nil, syntaxErr("nonce")
	}
	if m.IssuedAtText, ok = p.tagged(tagIssuedAt); !ok {
		return nil, syntaxErr("issued at")
	}
	if m.IssuedAt, err = parseDateTime(m.IssuedAtText, "issued at"); err != nil {
		return nil, err
	}

	// Optional fields, in ABNF order; each may appear at most once.
	if v, ok := p.tagged(tagExpiration); ok {
		t, err := parseDateTime(v, "expiration time")
		if err != nil {
			return nil, err
		}
		m.ExpirationTime, m.ExpirationTimeText = &t, v
	}
	if v, ok := p.tagged(tagNotBefore); ok {
		t, err := parseDateTime(v, "not before")
		if err != nil {
			return nil, err
		}
		m.NotBefore, m.NotBeforeText = &t, v
	}
	if v, ok := p.tagged(tagRequestID); ok {
		if !validRequestID(v) {
			return nil, syntaxErr("request id")
		}
		m.RequestID = &v
	}
	if l, ok := p.peek(); ok && l == tagResources {
		p.next()
		for {
			r, ok := p.tagged(resourcePrefix)
			if !ok {
				break
			}
			if !validURI(r) || len(m.Resources) == maxResources {
				return nil, syntaxErr("resource")
			}
			m.Resources = append(m.Resources, r)
		}
		if len(m.Resources) == 0 {
			return nil, syntaxErr("resources")
		}
	}
	if _, more := p.peek(); more {
		return nil, syntaxErr("trailing content")
	}
	return m, nil
}

type lineReader struct {
	lines []string
	i     int
}

func (p *lineReader) peek() (string, bool) {
	if p.i >= len(p.lines) {
		return "", false
	}
	return p.lines[p.i], true
}

func (p *lineReader) next() (string, bool) {
	l, ok := p.peek()
	if ok {
		p.i++
	}
	return l, ok
}

// tagged consumes the next line when it starts with tag and returns the rest.
func (p *lineReader) tagged(tag string) (string, bool) {
	l, ok := p.peek()
	if !ok || !strings.HasPrefix(l, tag) {
		return "", false
	}
	p.i++
	return l[len(tag):], true
}

func syntaxErr(field string) error { return fmt.Errorf("%w: %s", ErrSyntax, field) }

func validDomain(d string) bool {
	if !domainRe.MatchString(d) {
		return false
	}
	if _, port, ok := strings.Cut(d, ":"); ok {
		n, err := strconv.Atoi(port)
		return err == nil && n > 0 && n <= 65535 && port[0] != '0'
	}
	return true
}

// Statement characters: RFC 3986 reserved / unreserved, and space.
func validStatement(s string) bool {
	if len(s) > maxStatementSz {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !isUnreserved(s[i]) && !isReserved(s[i]) && s[i] != ' ' {
			return false
		}
	}
	return true
}

// validURI accepts an absolute RFC 3986 URI: only URI characters, a scheme,
// and well-formed percent-encoding.
func validURI(s string) bool {
	if s == "" || len(s) > 1024 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '%' {
			if i+2 >= len(s) || !isHex(s[i+1]) || !isHex(s[i+2]) {
				return false
			}
			continue
		}
		if !isUnreserved(c) && !isReserved(c) {
			return false
		}
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && schemeRe.MatchString(u.Scheme)
}

// request-id = *pchar; pchar = unreserved / pct-encoded / sub-delims / ":" / "@"
func validRequestID(s string) bool {
	if len(s) > 256 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '%':
			if i+2 >= len(s) || !isHex(s[i+1]) || !isHex(s[i+2]) {
				return false
			}
		case isUnreserved(c), isSubDelim(c), c == ':', c == '@':
		default:
			return false
		}
	}
	return true
}

func parseChainID(s string) (uint64, error) {
	if s == "" || len(s) > 20 || s[0] == '0' {
		return 0, syntaxErr("chain id")
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, syntaxErr("chain id")
		}
	}
	id, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, syntaxErr("chain id")
	}
	return id, nil
}

func parseDateTime(s, field string) (time.Time, error) {
	if !dateTimeRe.MatchString(s) {
		return time.Time{}, syntaxErr(field)
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, syntaxErr(field)
	}
	return t, nil
}

func isUnreserved(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
		c == '-' || c == '.' || c == '_' || c == '~'
}

func isSubDelim(c byte) bool { return strings.IndexByte("!$&'()*+,;=", c) >= 0 }

func isReserved(c byte) bool { return isSubDelim(c) || strings.IndexByte(":/?#[]@", c) >= 0 }

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

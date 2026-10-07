package service

import (
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// Sign-In with Ethereum switches. All default off: with MEMBA_ENABLE_SIWE
// unset the two SIWE RPCs answer Unimplemented and no EVM session validates.
// Enabling also needs a non-empty chain list and domain list, or SIWE stays off
// (fail closed) and the reason is logged at boot.
const (
	// SiweEnableEnv turns Sign-In with Ethereum on ("1" or "true").
	SiweEnableEnv = "MEMBA_ENABLE_SIWE"
	// SiweChainIDsEnv lists the EIP-155 chain ids users may sign in on, as
	// decimals ("84532") or CAIP-2 ("eip155:84532"), comma-separated. Only
	// chains in siweKnownChains are accepted.
	SiweChainIDsEnv = "MEMBA_SIWE_CHAIN_IDS"
	// SiweDomainsEnv lists the page origins a sign-in may come from,
	// comma-separated: exact hosts ("memba.club", "localhost:5173") or one
	// anchored pattern with a single "<n>" standing for a decimal number
	// ("deploy-preview-<n>--membaos.netlify.app"). No other wildcard exists.
	SiweDomainsEnv = "MEMBA_SIWE_DOMAINS"
)

// siweKnownChains are the chains the backend knows how to serve: Base and
// Base Sepolia. A chain id outside this set in SiweChainIDsEnv is refused.
var siweKnownChains = map[uint64]bool{8453: true, 84532: true}

const (
	siweChallengeTTL = 10 * time.Minute
	siweClockSkew    = time.Minute
	siweStatement    = "Sign in to Memba."
	// siweNumberMax bounds the "<n>" of a domain pattern (a PR number).
	siweNumberMaxDigits = 6
)

type siweHostPattern struct{ prefix, suffix string }

// siweConfig is the parsed SIWE configuration. The zero value is "off".
type siweConfig struct {
	enabled  bool
	chains   map[uint64]bool
	exact    map[string]bool // host[:port], lower case
	patterns []siweHostPattern
	now      func() time.Time
}

func (c siweConfig) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// ConfigureSiwe reads the SIWE switches through getenv (os.Getenv in
// production) and installs the result. A partial or invalid configuration
// leaves SIWE off and says why in the log.
func (s *MultisigService) ConfigureSiwe(getenv func(string) string) {
	cfg, problems := parseSiweConfig(getenv)
	for _, p := range problems {
		slog.Error("siwe: configuration refused, Sign-In with Ethereum stays off", "problem", p)
	}
	if cfg.enabled {
		slog.Info("siwe: Sign-In with Ethereum enabled",
			"chains", strings.TrimSpace(getenv(SiweChainIDsEnv)),
			"domains", strings.TrimSpace(getenv(SiweDomainsEnv)))
	}
	s.siwe = cfg
}

func parseSiweConfig(getenv func(string) string) (siweConfig, []string) {
	switch strings.TrimSpace(getenv(SiweEnableEnv)) {
	case "1", "true":
	default:
		return siweConfig{}, nil
	}
	cfg := siweConfig{enabled: true, chains: map[uint64]bool{}, exact: map[string]bool{}}
	var problems []string

	for _, raw := range splitList(getenv(SiweChainIDsEnv)) {
		ref := raw
		if address.IsEVMChainID(raw) {
			ref = strings.TrimPrefix(raw, "eip155:")
		}
		id, err := address.ParseCAIP2("eip155:" + ref)
		if err != nil || !siweKnownChains[id] {
			problems = append(problems, SiweChainIDsEnv+": unknown chain "+strconv.Quote(raw))
			continue
		}
		cfg.chains[id] = true
	}
	for _, raw := range splitList(getenv(SiweDomainsEnv)) {
		entry := strings.ToLower(raw)
		if prefix, suffix, ok := strings.Cut(entry, "<n>"); ok {
			if !validSiwePattern(prefix, suffix) {
				problems = append(problems, SiweDomainsEnv+": invalid pattern "+strconv.Quote(raw))
				continue
			}
			cfg.patterns = append(cfg.patterns, siweHostPattern{prefix, suffix})
			continue
		}
		if !validSiweHost(entry) {
			problems = append(problems, SiweDomainsEnv+": invalid domain "+strconv.Quote(raw))
			continue
		}
		cfg.exact[entry] = true
	}
	if len(cfg.chains) == 0 {
		problems = append(problems, SiweChainIDsEnv+" is empty")
	}
	if len(cfg.exact) == 0 && len(cfg.patterns) == 0 {
		problems = append(problems, SiweDomainsEnv+" is empty")
	}
	if len(problems) > 0 {
		return siweConfig{}, problems
	}
	return cfg, nil
}

func splitList(v string) []string {
	var out []string
	for p := range strings.SplitSeq(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// validSiweHost accepts host[:port] made of DNS labels; no scheme, path,
// userinfo or wildcard.
func validSiweHost(h string) bool {
	host, port, err := net.SplitHostPort(h)
	if err != nil {
		host, port = h, ""
	}
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n <= 0 || n > 65535 || port[0] == '0' {
			return false
		}
	}
	return validDNSName(host)
}

func validDNSName(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	for label := range strings.SplitSeq(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

// validSiwePattern: one "<n>" with a non-empty label part before it and a
// fixed registrable suffix after it (at least two labels), so a pattern can
// only ever stand for one numbered family of hosts under a domain we name.
// Pattern hosts never carry a port and are https only.
func validSiwePattern(prefix, suffix string) bool {
	if prefix == "" || strings.Contains(suffix, "<n>") || strings.Count(suffix, ".") < 1 ||
		strings.HasPrefix(suffix, ".") || strings.Contains(prefix, ".") {
		return false
	}
	// Substitute a sample number: the result must be a valid DNS name.
	return validDNSName(prefix + "1" + suffix)
}

// siweOrigin is a validated page origin: the SIWE domain (host[:port]) and
// URI (scheme://host[:port]) a message from it must name.
type siweOrigin struct{ scheme, domain, uri string }

// matchOrigin returns the origin when it is allowed. Allowed means https and an
// exact host or pattern match; plain http only for an exact loopback entry
// (local development).
func (c siweConfig) matchOrigin(origin string) (siweOrigin, bool) {
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Opaque != "" || u.Path != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.Host == "" || origin != strings.ToLower(origin) {
		return siweOrigin{}, false
	}
	o := siweOrigin{scheme: u.Scheme, domain: u.Host, uri: u.Scheme + "://" + u.Host}
	if o.uri != origin {
		return siweOrigin{}, false
	}
	switch u.Scheme {
	case "https":
	case "http":
		h := u.Hostname()
		if (h != "localhost" && h != "127.0.0.1") || !c.exact[u.Host] {
			return siweOrigin{}, false
		}
	default:
		return siweOrigin{}, false
	}
	if c.exact[u.Host] {
		return o, true
	}
	if u.Port() != "" {
		return siweOrigin{}, false
	}
	for _, p := range c.patterns {
		if c.matchPattern(p, u.Host) {
			return o, true
		}
	}
	return siweOrigin{}, false
}

func (c siweConfig) matchPattern(p siweHostPattern, host string) bool {
	if !strings.HasPrefix(host, p.prefix) || !strings.HasSuffix(host, p.suffix) ||
		len(host) <= len(p.prefix)+len(p.suffix) {
		return false
	}
	n := host[len(p.prefix) : len(host)-len(p.suffix)]
	if len(n) > siweNumberMaxDigits || n[0] == '0' {
		return false
	}
	for i := 0; i < len(n); i++ {
		if n[i] < '0' || n[i] > '9' {
			return false
		}
	}
	return true
}

// allowsDomain re-checks, at token time, that a challenge's domain is still
// configured (the list may have changed since the challenge was issued).
func (c siweConfig) allowsDomain(scheme, domain string) bool {
	_, ok := c.matchOrigin(scheme + "://" + domain)
	return ok
}

// SiweEnabled reports whether Sign-In with Ethereum is on.
func (s *MultisigService) SiweEnabled() bool { return s.siwe.enabled }

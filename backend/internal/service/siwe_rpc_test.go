package service

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"google.golang.org/protobuf/proto"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/address"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/siwe"
)

const (
	testSiweDomains = "memba.club, localhost:5173, deploy-preview-<n>--membaos.netlify.app"
	previewOrigin   = "https://deploy-preview-1497--membaos.netlify.app"
)

func envMap(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

// siweHarness is a service with SIWE on for Base Sepolia and a fixed clock.
func siweHarness(t *testing.T) (*testHarness, *time.Time) {
	t.Helper()
	h := setup(t)
	h.svc.acceptedChainIDs = []string{"gnoland-1"}
	h.svc.ConfigureSiwe(envMap(map[string]string{
		SiweEnableEnv: "true", SiweChainIDsEnv: "84532", SiweDomainsEnv: testSiweDomains,
	}))
	if !h.svc.SiweEnabled() {
		t.Fatal("SIWE did not enable")
	}
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	h.svc.siwe.now = func() time.Time { return now }
	return h, &now
}

func siweTestKey(n byte) (*secp256k1.PrivateKey, [20]byte) {
	var seed [32]byte
	seed[31] = n
	k := secp256k1.PrivKeyFromBytes(seed[:])
	return k, siwe.PubKeyAddress(k.PubKey())
}

func (h *testHarness) challenge(t *testing.T, origin, chain string) *membav1.SiweChallenge {
	t.Helper()
	req := connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: chain})
	req.Header().Set("Origin", origin)
	res, err := h.svc.GetSiweChallenge(context.Background(), req)
	if err != nil {
		t.Fatalf("GetSiweChallenge: %v", err)
	}
	return res.Msg.Challenge
}

// viemMessage renders the message the frontend builds from a challenge with
// viem createSiweMessage (ISO times with milliseconds).
func viemMessage(ch *membav1.SiweChallenge, addr [20]byte, edit func(*siwe.Message)) string {
	issued, _ := time.Parse(time.RFC3339, ch.IssuedAt)
	exp, _ := time.Parse(time.RFC3339, ch.Expiration)
	id, _ := address.ParseCAIP2(ch.ChainId)
	stmt := ch.Statement
	m := &siwe.Message{
		Domain: ch.Domain, Address: addr, AddrText: address.ChecksumHex(addr), Statement: &stmt,
		URI: ch.Uri, Version: "1", ChainID: id, Nonce: ch.Nonce,
		IssuedAt: issued, IssuedAtText: issued.UTC().Format("2006-01-02T15:04:05.000Z"),
		ExpirationTime: &exp, ExpirationTimeText: exp.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if edit != nil {
		edit(m)
	}
	return siwe.Format(m)
}

func shiftIssued(m *siwe.Message, d time.Duration) {
	m.IssuedAt = m.IssuedAt.Add(d)
	m.IssuedAtText = m.IssuedAt.Format(time.RFC3339)
}

func signEOA(key *secp256k1.PrivateKey, msg string) string {
	h := siwe.EIP191Hash(msg)
	c := ecdsa.SignCompact(key, h[:], false)
	return "0x" + hex.EncodeToString(append(append([]byte(nil), c[1:]...), c[0]))
}

func (h *testHarness) siweToken(ch *membav1.SiweChallenge, msg, sig string) (*membav1.Token, error) {
	res, err := h.svc.GetSiweToken(context.Background(), connect.NewRequest(&membav1.GetSiweTokenRequest{
		Challenge: ch, Message: msg, Signature: sig,
	}))
	if err != nil {
		return nil, err
	}
	return res.Msg.AuthToken, nil
}

func wantDenied(t *testing.T, err error, code string) {
	t.Helper()
	var cerr *connect.Error
	if !errors.As(err, &cerr) || cerr.Code() != connect.CodePermissionDenied || cerr.Message() != code {
		t.Fatalf("err = %v, want PermissionDenied %q", err, code)
	}
}

func TestSiweOffByDefault(t *testing.T) {
	h := setup(t)
	h.svc.ConfigureSiwe(envMap(map[string]string{SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club"}))
	if h.svc.SiweEnabled() {
		t.Fatal("SIWE on without MEMBA_ENABLE_SIWE")
	}
	req := connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: "eip155:84532"})
	req.Header().Set("Origin", "https://memba.club")
	if _, err := h.svc.GetSiweChallenge(context.Background(), req); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal(err)
	}
	if _, err := h.siweToken(&membav1.SiweChallenge{}, "", ""); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal(err)
	}
	if _, err := h.svc.authenticateAccount(h.evmToken(t, "eip155:84532", evmUser)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("EVM token validated with SIWE off")
	}
}

func TestParseSiweConfig(t *testing.T) {
	ok := func(chains, domains string) map[string]string {
		return map[string]string{SiweEnableEnv: "1", SiweChainIDsEnv: chains, SiweDomainsEnv: domains}
	}
	good := []map[string]string{
		ok("84532", "memba.club"),
		ok("eip155:84532, 8453", "deploy-preview-<n>--membaos.netlify.app"),
		ok("84532", "localhost:5173,memba.club"),
	}
	for _, env := range good {
		cfg, problems := parseSiweConfig(envMap(env))
		if !cfg.enabled || len(problems) > 0 {
			t.Errorf("%v: refused: %v", env, problems)
		}
	}
	bad := map[string]map[string]string{
		"no chains":            ok("", "memba.club"),
		"no domains":           ok("84532", ""),
		"unknown chain":        ok("1", "memba.club"),
		"chain leading zero":   ok("084532", "memba.club"),
		"one bad chain":        ok("84532,10", "memba.club"),
		"scheme in domain":     ok("84532", "https://memba.club"),
		"wildcard":             ok("84532", "*.netlify.app"),
		"pattern empty prefix": ok("84532", "<n>--membaos.netlify.app"),
		"pattern no dot":       ok("84532", "deploy-preview-<n>"),
		"pattern dotted head":  ok("84532", "x.deploy-<n>--membaos.netlify.app"),
		"two numbers":          ok("84532", "a-<n>-<n>.netlify.app"),
		"path in domain":       ok("84532", "memba.club/login"),
		"userinfo in domain":   ok("84532", "u@memba.club"),
		"bad port":             ok("84532", "memba.club:0"),
	}
	for name, env := range bad {
		cfg, problems := parseSiweConfig(envMap(env))
		if cfg.enabled || len(problems) == 0 {
			t.Errorf("%s: accepted", name)
		}
	}
	for _, v := range []string{"", "0", "false", "yes", "TRUE "} {
		if cfg, _ := parseSiweConfig(envMap(map[string]string{SiweEnableEnv: v, SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club"})); cfg.enabled && v != "TRUE " {
			t.Errorf("enabled by %q", v)
		}
	}
}

func TestSiweMatchOrigin(t *testing.T) {
	cfg, problems := parseSiweConfig(envMap(map[string]string{SiweEnableEnv: "true", SiweChainIDsEnv: "84532", SiweDomainsEnv: testSiweDomains}))
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	for origin, wantDomain := range map[string]string{
		"https://memba.club":                                 "memba.club",
		"http://localhost:5173":                              "localhost:5173",
		"https://localhost:5173":                             "localhost:5173",
		previewOrigin:                                        "deploy-preview-1497--membaos.netlify.app",
		"https://deploy-preview-1--membaos.netlify.app":      "deploy-preview-1--membaos.netlify.app",
		"https://deploy-preview-999999--membaos.netlify.app": "deploy-preview-999999--membaos.netlify.app",
	} {
		o, ok := cfg.matchOrigin(origin)
		if !ok || o.domain != wantDomain || o.uri != origin {
			t.Errorf("%s: %+v %v", origin, o, ok)
		}
	}
	for _, origin := range []string{
		"", "null", "memba.club", "http://memba.club", "https://memba.club/", "https://memba.club:443",
		"https://MEMBA.club", "https://evil.memba.club", "https://memba.club.evil.com", "https://user@memba.club",
		"http://localhost:3000", "http://127.0.0.1:5173", "ftp://memba.club", "https://memba.club?x=1",
		"https://deploy-preview-01--membaos.netlify.app", "https://deploy-preview-1234567--membaos.netlify.app",
		"https://deploy-preview---membaos.netlify.app", "https://deploy-preview-1a--membaos.netlify.app",
		"https://deploy-preview-1--membaos.netlify.app.evil.com", "https://xdeploy-preview-1--membaos.netlify.app",
		"https://deploy-preview-1--membaos.netlify.app:8443", "https://deploy-preview-1--othersite.netlify.app",
		"http://deploy-preview-1--membaos.netlify.app", "https://deploy-preview-1-x--membaos.netlify.app",
		"https://a.deploy-preview-1--membaos.netlify.app",
	} {
		if o, ok := cfg.matchOrigin(origin); ok {
			t.Errorf("%q accepted as %+v", origin, o)
		}
	}
}

func TestSiweEOASignIn(t *testing.T) {
	h, _ := siweHarness(t)
	key, addr := siweTestKey(1)
	ch := h.challenge(t, previewOrigin, "eip155:84532")
	if ch.Domain != "deploy-preview-1497--membaos.netlify.app" || ch.Uri != previewOrigin || ch.ChainId != "eip155:84532" ||
		len(ch.Nonce) != 32 || ch.Statement == "" || ch.IssuedAt != "2026-10-07T12:00:00Z" || ch.Expiration != "2026-10-07T12:10:00Z" {
		t.Fatalf("challenge: %+v", ch)
	}
	msg := viemMessage(ch, addr, nil)
	tok, err := h.siweToken(ch, msg, signEOA(key, msg))
	if err != nil {
		t.Fatalf("GetSiweToken: %v", err)
	}
	if tok.ChainId != "eip155:84532" || tok.UserAddress != "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" {
		t.Fatalf("token: %+v", tok)
	}

	// The session works where a handler opts in, nowhere else.
	if got, err := h.svc.authenticateAccount(tok); err != nil || got != tok.UserAddress {
		t.Fatalf("authenticateAccount = %q, %v", got, err)
	}
	if _, err := h.svc.authenticate(tok); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("a Gno-only handler accepted the EVM session")
	}
	// Turning SIWE off ends the session at once.
	h.svc.ConfigureSiwe(envMap(nil))
	if _, err := h.svc.authenticateAccount(tok); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("EVM session survived SIWE being turned off")
	}
}

func TestSiweNonceIsSingleUseAcrossRestarts(t *testing.T) {
	h, now := siweHarness(t)
	key, addr := siweTestKey(1)
	ch := h.challenge(t, "https://memba.club", "eip155:84532")
	msg := viemMessage(ch, addr, nil)
	sig := signEOA(key, msg)
	if _, err := h.siweToken(ch, msg, sig); err != nil {
		t.Fatal(err)
	}
	_, err := h.siweToken(ch, msg, sig)
	wantDenied(t, err, "")

	// A restarted server (same key, same database, nothing in memory) still
	// refuses it.
	restarted := &MultisigService{db: h.db, publicKey: h.svc.publicKey, privateKey: h.svc.privateKey}
	restarted.siwe = h.svc.siwe
	_, err = (&testHarness{svc: restarted, db: h.db}).siweToken(ch, msg, sig)
	wantDenied(t, err, "")

	// Pruning keeps the row while the challenge could still be presented...
	if err := h.svc.PruneSiweNonces(context.Background()); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM siwe_used_nonces`).Scan(&n)
	if n != 1 {
		t.Fatalf("rows = %d before expiry", n)
	}
	// ...and drops it once the challenge is refused as expired anyway.
	*now = now.Add(siweChallengeTTL + 2*siweClockSkew)
	_, err = h.siweToken(ch, msg, sig)
	wantDenied(t, err, "")
	if err := h.svc.PruneSiweNonces(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM siwe_used_nonces`).Scan(&n)
	if n != 0 {
		t.Fatalf("rows = %d after expiry", n)
	}
}

func TestSiweTokenRefusals(t *testing.T) {
	key, addr := siweTestKey(1)
	other, otherAddr := siweTestKey(2)
	cases := map[string]struct {
		edit    func(*siwe.Message)
		mutate  func(ch *membav1.SiweChallenge) // after signing: tampering
		sig     func(msg string) string
		advance time.Duration
		reenv   map[string]string
		code    string
	}{
		"other domain":         {edit: func(m *siwe.Message) { m.Domain = "memba.club" }},
		"scheme mismatch":      {edit: func(m *siwe.Message) { m.Scheme = "http" }},
		"other uri":            {edit: func(m *siwe.Message) { m.URI = previewOrigin + "/login" }},
		"other chain":          {edit: func(m *siwe.Message) { m.ChainID = 8453 }},
		"other nonce":          {edit: func(m *siwe.Message) { m.Nonce = strings.Repeat("a", 32) }},
		"issued long before":   {edit: func(m *siwe.Message) { shiftIssued(m, -2*time.Minute) }},
		"issued in the future": {edit: func(m *siwe.Message) { shiftIssued(m, 2*time.Minute) }},
		"outlives challenge": {edit: func(m *siwe.Message) {
			e := m.ExpirationTime.Add(time.Second)
			m.ExpirationTime, m.ExpirationTimeText = &e, e.Format(time.RFC3339)
		}},
		"not yet valid": {edit: func(m *siwe.Message) {
			nb := m.IssuedAt.Add(5 * time.Minute)
			m.NotBefore, m.NotBeforeText = &nb, nb.Format(time.RFC3339)
		}},
		"resources":            {edit: func(m *siwe.Message) { m.Resources = []string{"https://memba.club/x"} }},
		"address of other key": {edit: func(m *siwe.Message) { m.Address, m.AddrText = otherAddr, address.ChecksumHex(otherAddr) }},
		"signed by other key":  {sig: func(msg string) string { return signEOA(other, msg) }},
		"signature not 0x":     {sig: func(msg string) string { return strings.TrimPrefix(signEOA(key, msg), "0x") }},
		"signature not hex":    {sig: func(string) string { return "0xzz" }},
		"contract signature":   {sig: func(string) string { return "0x" + strings.Repeat("ab", 200) }},
		"oversized signature":  {sig: func(string) string { return "0x" + strings.Repeat("ab", 9000) }},
		"challenge tampered":   {mutate: func(ch *membav1.SiweChallenge) { ch.Expiration = "2030-01-01T00:00:00Z" }},
		"challenge unsigned":   {mutate: func(ch *membav1.SiweChallenge) { ch.ServerSignature = nil }},
		"challenge expired":    {advance: siweChallengeTTL},
		"domain removed":       {reenv: map[string]string{SiweEnableEnv: "1", SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club"}},
		"chain removed": {
			reenv: map[string]string{SiweEnableEnv: "1", SiweChainIDsEnv: "8453", SiweDomainsEnv: testSiweDomains},
			code:  auth.ChainMismatchCode,
		},
		"malformed message": {sig: func(string) string { return "0x00" }, edit: func(m *siwe.Message) { m.Version = "2" }},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h, now := siweHarness(t)
			ch := h.challenge(t, previewOrigin, "eip155:84532")
			msg := viemMessage(ch, addr, tc.edit)
			sig := signEOA(key, msg)
			if tc.sig != nil {
				sig = tc.sig(msg)
			}
			if tc.mutate != nil {
				tc.mutate(ch)
			}
			if tc.reenv != nil {
				clock := h.svc.siwe.now
				h.svc.ConfigureSiwe(envMap(tc.reenv))
				h.svc.siwe.now = clock
			}
			*now = now.Add(tc.advance)
			tok, err := h.siweToken(ch, msg, sig)
			if tok != nil {
				t.Fatalf("token issued: %+v", tok)
			}
			wantDenied(t, err, tc.code)
		})
	}
}

func TestSiweChallengeRefusals(t *testing.T) {
	h, _ := siweHarness(t)
	for _, chain := range []string{"eip155:8453", "eip155:1", "84532", "gnoland-1", ""} {
		req := connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: chain})
		req.Header().Set("Origin", "https://memba.club")
		_, err := h.svc.GetSiweChallenge(context.Background(), req)
		wantDenied(t, err, auth.ChainMismatchCode)
	}
	for _, origin := range []string{"", "https://evil.example", "http://memba.club"} {
		req := connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: "eip155:84532"})
		if origin != "" {
			req.Header().Set("Origin", origin)
		}
		_, err := h.svc.GetSiweChallenge(context.Background(), req)
		wantDenied(t, err, "")
	}
}

// A Gno login challenge and a SIWE challenge cannot stand in for each other:
// the SIWE one is signed under its own context prefix.
func TestSiweChallengeDomainSeparation(t *testing.T) {
	h, _ := siweHarness(t)
	ch := h.challenge(t, "https://memba.club", "eip155:84532")
	plain, _ := proto.Marshal(&membav1.SiweChallenge{
		Nonce: ch.Nonce, ChainId: ch.ChainId, Domain: ch.Domain, Uri: ch.Uri,
		IssuedAt: ch.IssuedAt, Expiration: ch.Expiration, Statement: ch.Statement,
	})
	if len(ch.ServerSignature) == 0 || strings.HasPrefix(string(plain), "memba/") {
		t.Fatal("unexpected encoding")
	}
	gno := &membav1.Challenge{Nonce: []byte(ch.Nonce), Expiration: ch.Expiration, ServerSignature: ch.ServerSignature, ChainId: ch.ChainId}
	if err := auth.ValidateChallenge(h.svc.publicKey, gno); err == nil {
		t.Fatal("a SIWE challenge signature validated as a Gno challenge")
	}
}

func TestAuthenticateAccount(t *testing.T) {
	h, _ := siweHarness(t)
	gno := h.evmToken(t, "gnoland-1", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	if got, err := h.svc.authenticateAccount(gno); err != nil || got != gno.UserAddress {
		t.Fatalf("Gno token: %q %v", got, err)
	}
	scoped := "eip155:84532:" + evmUser
	for user, ok := range map[string]bool{
		evmUser:                  true,
		scoped:                   true,
		"eip155:8453:" + evmUser: false, // scoped to another chain
		"0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf": false, // not canonical
		"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5":   false, // a Gno address in an EVM session
		"": false, "0x1234": false,
	} {
		got, err := h.svc.authenticateAccount(h.evmToken(t, "eip155:84532", user))
		if ok != (err == nil) || (ok && got != user) {
			t.Errorf("%q: %q %v", user, got, err)
		}
	}
	for _, chain := range []string{"eip155:8453", "eip155:", "eip155:084532"} {
		if _, err := h.svc.authenticateAccount(h.evmToken(t, chain, evmUser)); err == nil {
			t.Errorf("chain %q accepted", chain)
		}
	}
	expired := h.evmToken(t, "eip155:84532", evmUser)
	expired.Expiration = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	if _, err := h.svc.authenticateAccount(expired); err == nil {
		t.Error("tampered/expired token accepted")
	}
}

func FuzzGetSiweToken(f *testing.F) {
	// One service per fuzz worker: migrating a database per input would leave
	// the fuzzer a handful of executions.
	database, err := db.Open(":memory:")
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(func() { _ = database.Close() })
	if err := db.Migrate(database); err != nil {
		f.Fatal(err)
	}
	priv := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	svc := &MultisigService{db: database, privateKey: priv, publicKey: priv.Public().(ed25519.PublicKey)}
	svc.ConfigureSiwe(envMap(map[string]string{SiweEnableEnv: "1", SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club"}))
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	svc.siwe.now = func() time.Time { return now }
	h := &testHarness{svc: svc, db: database}
	req := connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: "eip155:84532"})
	req.Header().Set("Origin", "https://memba.club")
	res, err := svc.GetSiweChallenge(context.Background(), req)
	if err != nil {
		f.Fatal(err)
	}
	ch := res.Msg.Challenge
	_, addr := siweTestKey(1)
	valid := viemMessage(ch, addr, nil)
	f.Add(valid, "0x"+strings.Repeat("11", 65))
	f.Add(valid, "0x")
	f.Fuzz(func(t *testing.T, msg, sig string) {
		// The seed message carries the real challenge, so mutations of it get
		// past parsing and binding; no fuzzed signature may ever mint a token.
		if tok, err := h.siweToken(ch, msg, sig); err == nil || tok != nil {
			t.Fatalf("token minted for a fuzzed signature: %v", tok)
		}
	})
}

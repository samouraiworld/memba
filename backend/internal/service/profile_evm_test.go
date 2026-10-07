package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/address"
)

func (h *testHarness) getProfile(t *testing.T, addr string) *membav1.Profile {
	t.Helper()
	res, err := h.svc.GetProfile(context.Background(), connect.NewRequest(&membav1.GetProfileRequest{Address: addr}))
	if err != nil {
		t.Fatalf("GetProfile(%q): %v", addr, err)
	}
	return res.Msg.Profile
}

func (h *testHarness) updateProfile(tok *membav1.Token, p *membav1.Profile) (*membav1.Profile, error) {
	res, err := h.svc.UpdateProfile(context.Background(), connect.NewRequest(&membav1.UpdateProfileRequest{AuthToken: tok, Profile: p}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Profile, nil
}

// An EVM key holder signed in with Ethereum edits the profile keyed by its
// canonical address, readable under any spelling of that address.
func TestUpdateProfileWithSiweSession(t *testing.T) {
	h, _ := siweHarness(t)
	key, addr := siweTestKey(1)
	ch := h.challenge(t, "https://memba.club", "eip155:84532")
	msg := viemMessage(ch, addr, nil)
	tok, err := h.siweToken(ch, msg, signEOA(key, msg))
	if err != nil {
		t.Fatal(err)
	}
	canonical := address.EOA(addr).String()
	checksummed := address.ChecksumHex(addr)

	// The client may name its own address in either spelling.
	p, err := h.updateProfile(tok, &membav1.Profile{Address: checksummed, Bio: "builder on Base"})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if p.Address != canonical {
		t.Fatalf("stored under %q, want %q", p.Address, canonical)
	}
	for _, spelling := range []string{canonical, checksummed, " " + checksummed + " "} {
		if got := h.getProfile(t, spelling); got.Bio != "builder on Base" || got.Address != canonical {
			t.Fatalf("GetProfile(%q) = %+v", spelling, got)
		}
	}
	// The chain-bound spelling of the same bytes is another identity.
	if got := h.getProfile(t, "eip155:84532:"+canonical); got.Bio != "" {
		t.Fatal("a contract-account identity read the key holder's profile")
	}

	// Nobody edits someone else's profile, in any spelling.
	_, other := siweTestKey(2)
	for _, target := range []string{address.ChecksumHex(other), address.EOA(other).String(), "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"} {
		if _, err := h.updateProfile(tok, &membav1.Profile{Address: target, Bio: "x"}); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("edit of %q: %v", target, err)
		}
	}

	// Turning SIWE off ends the EVM session for profile edits too.
	h.svc.ConfigureSiwe(envMap(nil))
	if _, err := h.updateProfile(tok, &membav1.Profile{Bio: "y"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("EVM session edited a profile with SIWE off: %v", err)
	}
}

// Gno sessions and Gno profile reads behave exactly as before.
func TestUpdateProfileGnoUnchanged(t *testing.T) {
	h, _ := siweHarness(t)
	gno := "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	tok := h.evmToken(t, "gnoland-1", gno)
	p, err := h.updateProfile(tok, &membav1.Profile{Address: gno, Bio: "gno"})
	if err != nil || p.Address != gno {
		t.Fatalf("%+v %v", p, err)
	}
	if got := h.getProfile(t, " "+gno+" "); got.Bio != "gno" {
		t.Fatalf("%+v", got)
	}
}

func TestProfileKey(t *testing.T) {
	for in, want := range map[string]string{
		"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed":              "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
		" 0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED ":            "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
		"eip155:84532:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed": "eip155:84532:0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
		// Everything else is only trimmed, as before: Gno addresses (any
		// spelling), bad checksums, garbage.
		"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5":   "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
		" G1JG8MTUTU9KHHFWC4NXMUHCPFTF0PAJDHFVSQF5":  "G1JG8MTUTU9KHHFWC4NXMUHCPFTF0PAJDHFVSQF5",
		"0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed": "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
		"g1testuser123": "g1testuser123", "": "",
	} {
		if got := profileKey(in); got != want {
			t.Errorf("profileKey(%q) = %q, want %q", in, got, want)
		}
	}
}

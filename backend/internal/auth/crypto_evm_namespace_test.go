package auth

import (
	"strings"
	"testing"
	"time"
)

// The Gno login never mints into the EVM chain namespace: an EVM identity can
// only come from Sign-In with Ethereum. Checked in every accepted-set posture,
// including the legacy accept-any one (no set), where F-29 alone would let it
// through, and a set that explicitly lists the EVM chain.
func TestMakeToken_RefusesEVMChainNamespace(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	for _, accepted := range [][]string{nil, {"eip155:8453"}, {"gnoland-1", "eip155:8453"}} {
		for _, chain := range []string{"eip155:8453", "eip155:84532", "eip155:"} {
			infoJSON := buildEmptySigAuthInfo(t, serverPriv, chain)
			tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "gnoland-1", accepted...)
			if err == nil {
				t.Fatalf("accepted=%v chain=%q: Gno login minted %+v", accepted, chain, tok)
			}
			if !strings.Contains(err.Error(), ChainMismatchCode) {
				t.Fatalf("error must carry %s for the UI, got %v", ChainMismatchCode, err)
			}
		}
	}
}

// Control: the same request on a Gno chain still mints.
func TestMakeToken_GnoChainUnaffectedByEVMRefusal(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "gnoland-1")
	if _, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "gnoland-1", "gnoland-1"); err != nil {
		t.Fatal(err)
	}
}

func TestIsEVMChainID(t *testing.T) {
	for in, want := range map[string]bool{
		"eip155:8453": true, "eip155:84532": true, "eip155:": true,
		"gnoland-1": false, "test12": false, "": false, "EIP155:8453": false, "xeip155:1": false,
	} {
		if IsEVMChainID(in) != want {
			t.Errorf("IsEVMChainID(%q) != %v", in, want)
		}
	}
}

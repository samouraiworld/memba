package gnomultisig

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
)

func fixtureIdentity(t *testing.T) string {
	t.Helper()
	a, _ := hex.DecodeString("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
	b, _ := hex.DecodeString("02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5")
	return fmt.Sprintf(`{"@type":"/tm.PubKeyMultisig","threshold":"2","pubkeys":[{"@type":"/tm.PubKeySecp256k1","value":"%s"},{"@type":"/tm.PubKeySecp256k1","value":"%s"}]}`, base64.StdEncoding.EncodeToString(a), base64.StdEncoding.EncodeToString(b))
}

func TestNativeIdentityGolden(t *testing.T) {
	pk, err := Parse(fixtureIdentity(t))
	if err != nil {
		t.Fatal(err)
	}
	if got := pk.Address().String(); got != "g14sngp6hjx9jchqk4pmkqrkesdklhwpd43q5vur" {
		t.Fatal(got)
	}
	for i, expected := range []string{"g1w508d6qejxtdg4y5r3zarvary0c5xw7kfptewu", "g1q6hag67dl53wl99vzg42z8eyzfz2xlkvrl6lhg"} {
		if got := pk.PubKeys[i].Address().String(); got != expected {
			t.Fatal(got)
		}
	}
	if CanonicalOrder(pk) {
		t.Fatal("fixture is intentionally unsorted")
	}
	j, err := JSON(pk)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(j); err != nil {
		t.Fatal(err)
	}
	t.Logf("native preimage: %x", pk.Bytes())
}

func TestIdentityRejectsAmbiguity(t *testing.T) {
	valid := fixtureIdentity(t)
	for _, raw := range []string{
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"0"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"3"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"-1"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"4294967298"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"18446744073709551615"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"02"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"1","threshold":"2"`, 1),
		strings.Replace(valid, `"threshold":"2"`, `"threshold":"2","value":{}`, 1),
		strings.Replace(valid, "/tm.PubKeySecp256k1", "/tm.PubKeyEd25519", 1),
		valid + "{}",
	} {
		if _, err := Parse(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

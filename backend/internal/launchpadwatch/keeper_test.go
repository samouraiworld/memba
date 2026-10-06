package launchpadwatch

import (
	"math/big"
	"strings"
	"testing"
)

func TestCheckSweepCountsOnlyTheSalesRealmsEvent(t *testing.T) {
	plan := SweepPlan{Fees: big.NewInt(10), Treasury: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"}
	ev := func(pkg, currency, amount string) string {
		return `{"type":"LaunchpadFeesSwept","pkg_path":"` + pkg + `","attrs":[{"key":"currency","value":"` + currency +
			`"},{"key":"treasury","value":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"},{"key":"amount","value":"` + amount + `"}]}`
	}
	pay := `{"from":"` + realmAddress(salesRealm) + `","to":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5","coins":[{"denom":"ugnot","amount":12}]}`
	ok := "[" + pay + "," + ev("gno.land/r/evil/fake", "ugnot", "999") + "," + ev(salesRealm, "ugnot", "12") + "]"
	if got, err := CheckSweep(plan, []byte(ok)); err != nil || got.Int64() != 12 {
		t.Fatalf("got %v, %v", got, err)
	}
	for name, bad := range map[string]string{
		"only another realm": "[" + pay + "," + ev("gno.land/r/evil/fake", "ugnot", "12") + "]",
		"two events":         "[" + pay + "," + ev(salesRealm, "ugnot", "12") + "," + ev(salesRealm, "ugnot", "12") + "]",
		"other currency":     "[" + pay + "," + ev(salesRealm, "foo", "12") + "]",
		"not json":           "OK!",
	} {
		if _, err := CheckSweep(plan, []byte(bad)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAddressAnswer(t *testing.T) {
	for in, want := range map[string]bool{
		`("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" .uverse.address)`: true,
		`("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" std.Address)`:     true,
		`("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" string)`:          false,
		`(nil .uverse.address)`: false,
	} {
		if got := addressAnswer.MatchString(strings.TrimSpace(in)); got != want {
			t.Errorf("%s: %v, want %v", in, got, want)
		}
	}
}

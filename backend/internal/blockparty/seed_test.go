package blockparty

import "testing"

func TestDeriveSeed_Deterministic(t *testing.T) {
	a := DeriveSeed("ABC123", "2026-07-06")
	b := DeriveSeed("ABC123", "2026-07-06")
	if a != b {
		t.Fatalf("non-deterministic: %d vs %d", a, b)
	}
	if DeriveSeed("ABC123", "2026-07-07") == a {
		t.Fatal("seed should change with date")
	}
	if DeriveSeed("XYZ999", "2026-07-06") == a {
		t.Fatal("seed should change with block hash")
	}
}

func TestDeriveModifier_InSet(t *testing.T) {
	set := map[string]bool{"standard": true, "doubles": true, "rush": true}
	for _, h := range []string{"a", "b", "c", "deadbeef", "0"} {
		m := DeriveModifier(DeriveSeed(h, "2026-07-06"))
		if !set[m] {
			t.Fatalf("modifier %q not in set", m)
		}
	}
}

func TestDerivePar_PositiveDeterministic(t *testing.T) {
	s := DeriveSeed("ABC", "2026-07-06")
	p := DerivePar(s)
	if p <= 0 {
		t.Fatal("par must be positive")
	}
	if DerivePar(s) != p {
		t.Fatal("par must be deterministic")
	}
}

package chainauth

import (
	"testing"
)

func TestDetectFamily(t *testing.T) {
	tests := []struct {
		address string
		want    ChainFamily
	}{
		{"g1abc123def456ghi789jkl012mno345pqr678stu", FamilyGno},
		{"0x1234567890abcdef1234567890abcdef12345678", FamilyEVM},
		{"0X1234567890ABCDEF1234567890ABCDEF12345678", FamilyEVM},
		{"", ""},
		{"cosmos1abc", ""},
	}

	for _, tt := range tests {
		got := DetectFamily(tt.address)
		if got != tt.want {
			t.Errorf("DetectFamily(%q) = %q, want %q", tt.address, got, tt.want)
		}
	}
}

func TestDualVerifier_UnsupportedFamily(t *testing.T) {
	dv := NewDualVerifier(nil, nil)
	_, err := dv.Verify(&LoginProof{Family: "solana"}, nil)
	if err == nil {
		t.Fatal("expected error for unsupported family")
	}
}

func TestDualVerifier_NilEvmVerifier(t *testing.T) {
	dv := NewDualVerifier(nil, nil)
	_, err := dv.Verify(&LoginProof{Family: FamilyEVM}, nil)
	if err == nil {
		t.Fatal("expected error when EVM verifier is nil")
	}
}

func TestDualVerifier_NilGnoVerifier(t *testing.T) {
	dv := NewDualVerifier(nil, nil)
	_, err := dv.Verify(&LoginProof{Family: FamilyGno}, nil)
	if err == nil {
		t.Fatal("expected error when Gno verifier is nil")
	}
}

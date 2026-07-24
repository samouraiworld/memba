package chainreader

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
		got := detectFamily(tt.address)
		if got != tt.want {
			t.Errorf("detectFamily(%q) = %q, want %q", tt.address, got, tt.want)
		}
	}
}

func TestDualReader_ForFamily(t *testing.T) {
	dr := NewDualReader(nil, nil)

	_, err := dr.ForFamily(FamilyGno)
	if err == nil {
		t.Fatal("expected error for nil gno reader")
	}

	_, err = dr.ForFamily(FamilyEVM)
	if err == nil {
		t.Fatal("expected error for nil evm reader")
	}

	_, err = dr.ForFamily("solana")
	if err == nil {
		t.Fatal("expected error for unsupported family")
	}
}

func TestDualReader_ForAddress(t *testing.T) {
	dr := NewDualReader(nil, nil)

	_, err := dr.ForAddress("g1abc")
	if err == nil {
		t.Fatal("expected error for nil gno reader via address detection")
	}

	_, err = dr.ForAddress("0x1234")
	if err == nil {
		t.Fatal("expected error for nil evm reader via address detection")
	}

	_, err = dr.ForAddress("unknown")
	if err == nil {
		t.Fatal("expected error for undetectable address")
	}
}

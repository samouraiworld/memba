package service

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// ── sanitize / stripHTML / sanitizeURL unit tests ────────────

func TestSanitize_TruncatesAtMaxLen(t *testing.T) {
	input := strings.Repeat("a", 600)
	result := sanitize(input, maxBioLen)
	if len([]rune(result)) != maxBioLen {
		t.Fatalf("expected %d runes, got %d", maxBioLen, len([]rune(result)))
	}
}

func TestSanitize_StripsHTML(t *testing.T) {
	result := sanitize("<b>bold</b> <script>alert(1)</script>text", 256)
	if strings.Contains(result, "<") || strings.Contains(result, ">") {
		t.Fatalf("HTML not stripped: %q", result)
	}
	if result != "bold alert(1)text" {
		t.Fatalf("unexpected result: %q", result)
	}
}

func TestSanitize_TrimsWhitespace(t *testing.T) {
	result := sanitize("  hello world  ", 128)
	if result != "hello world" {
		t.Fatalf("expected trimmed string, got %q", result)
	}
}

func TestSanitize_EmptyString(t *testing.T) {
	result := sanitize("", 128)
	if result != "" {
		t.Fatalf("expected empty string, got %q", result)
	}
}

func TestSanitize_UnicodeRunes(t *testing.T) {
	// 5 emoji runes, each 1 rune but 4 bytes
	input := "🎉🎊🎈🎁🎂"
	result := sanitize(input, 3)
	if result != "🎉🎊🎈" {
		t.Fatalf("expected 3 emoji runes, got %q", result)
	}
}

func TestStripHTML_NestedTags(t *testing.T) {
	result := stripHTML("<div><p>Hello <strong>world</strong></p></div>")
	if result != "Hello world" {
		t.Fatalf("expected 'Hello world', got %q", result)
	}
}

func TestStripHTML_NoTags(t *testing.T) {
	result := stripHTML("no tags here")
	if result != "no tags here" {
		t.Fatalf("expected unchanged string, got %q", result)
	}
}

func TestSanitizeURL_ValidHTTPS(t *testing.T) {
	result := sanitizeURL("https://example.com/path", maxURLLen)
	if result != "https://example.com/path" {
		t.Fatalf("expected valid URL preserved, got %q", result)
	}
}

func TestSanitizeURL_ValidHTTP(t *testing.T) {
	result := sanitizeURL("http://example.com", maxURLLen)
	if result != "http://example.com" {
		t.Fatalf("expected valid URL preserved, got %q", result)
	}
}

func TestSanitizeURL_InvalidScheme(t *testing.T) {
	result := sanitizeURL("ftp://example.com", maxURLLen)
	if result != "" {
		t.Fatalf("expected empty for ftp scheme, got %q", result)
	}
}

func TestSanitizeURL_JavascriptScheme(t *testing.T) {
	result := sanitizeURL("javascript:alert(1)", maxURLLen)
	if result != "" {
		t.Fatalf("expected empty for javascript scheme, got %q", result)
	}
}

func TestSanitizeURL_NoHost(t *testing.T) {
	result := sanitizeURL("https://", maxURLLen)
	if result != "" {
		t.Fatalf("expected empty for URL without host, got %q", result)
	}
}

func TestSanitizeURL_TooLong(t *testing.T) {
	url := "https://example.com/" + strings.Repeat("a", maxURLLen)
	result := sanitizeURL(url, maxURLLen)
	if result != "" {
		t.Fatalf("expected empty for oversized URL, got length %d", len(result))
	}
}

func TestSanitizeURL_Empty(t *testing.T) {
	result := sanitizeURL("", maxURLLen)
	if result != "" {
		t.Fatalf("expected empty, got %q", result)
	}
}

func TestSanitizeURL_Whitespace(t *testing.T) {
	result := sanitizeURL("   ", maxURLLen)
	if result != "" {
		t.Fatalf("expected empty for whitespace-only, got %q", result)
	}
}

// ── Profile RPC integration tests ───────────────────────────

func TestGetProfile_EmptyAddress(t *testing.T) {
	h := setup(t)

	_, err := h.svc.GetProfile(t.Context(), connect.NewRequest(&membav1.GetProfileRequest{
		Address: "",
	}))
	if err == nil {
		t.Fatal("expected error for empty address")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", connect.CodeOf(err))
	}
}

func TestGetProfile_NonExistentUser(t *testing.T) {
	h := setup(t)

	resp, err := h.svc.GetProfile(t.Context(), connect.NewRequest(&membav1.GetProfileRequest{
		Address: "g1nonexistent",
	}))
	if err != nil {
		t.Fatal("expected no error for missing profile:", err)
	}
	// Should return an empty profile with the address set
	if resp.Msg.Profile.Address != "g1nonexistent" {
		t.Fatalf("expected address 'g1nonexistent', got %q", resp.Msg.Profile.Address)
	}
	if resp.Msg.Profile.Bio != "" {
		t.Fatalf("expected empty bio, got %q", resp.Msg.Profile.Bio)
	}
}

func TestUpdateProfile_Success(t *testing.T) {
	h := setup(t)
	addr := "g1testuser123"
	token := h.makeToken(t, addr)

	resp, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: addr,
			Bio:     "Hello world",
			Company: "Samourai Coop",
			Title:   "Engineer",
			Website: "https://samourai.world",
		},
	}))
	if err != nil {
		t.Fatal("update failed:", err)
	}
	if resp.Msg.Profile.Bio != "Hello world" {
		t.Fatalf("expected bio 'Hello world', got %q", resp.Msg.Profile.Bio)
	}
	if resp.Msg.Profile.UpdatedAt == "" {
		t.Fatal("expected UpdatedAt to be set")
	}
}

func TestUpdateProfile_SanitizesHTML(t *testing.T) {
	h := setup(t)
	addr := "g1testuser123"
	token := h.makeToken(t, addr)

	resp, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: addr,
			Bio:     "<script>alert('xss')</script>Clean bio",
		},
	}))
	if err != nil {
		t.Fatal("update failed:", err)
	}
	if strings.Contains(resp.Msg.Profile.Bio, "<script>") {
		t.Fatalf("HTML not stripped from bio: %q", resp.Msg.Profile.Bio)
	}
}

func TestUpdateProfile_TruncatesBio(t *testing.T) {
	h := setup(t)
	addr := "g1testuser123"
	token := h.makeToken(t, addr)

	longBio := strings.Repeat("x", 1000)
	resp, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: addr,
			Bio:     longBio,
		},
	}))
	if err != nil {
		t.Fatal("update failed:", err)
	}
	if len([]rune(resp.Msg.Profile.Bio)) != maxBioLen {
		t.Fatalf("expected bio truncated to %d runes, got %d", maxBioLen, len([]rune(resp.Msg.Profile.Bio)))
	}
}

func TestUpdateProfile_RejectsInvalidURL(t *testing.T) {
	h := setup(t)
	addr := "g1testuser123"
	token := h.makeToken(t, addr)

	resp, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: addr,
			Website: "javascript:alert(1)",
		},
	}))
	if err != nil {
		t.Fatal("update failed:", err)
	}
	if resp.Msg.Profile.Website != "" {
		t.Fatalf("expected empty website for invalid URL, got %q", resp.Msg.Profile.Website)
	}
}

func TestUpdateProfile_CannotUpdateOtherUser(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1userA")

	_, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: "g1userB",
			Bio:     "Hijacking profile",
		},
	}))
	if err == nil {
		t.Fatal("expected error when updating another user's profile")
	}
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", connect.CodeOf(err))
	}
}

func TestUpdateProfile_NilProfile(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1testuser")

	_, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile:   nil,
	}))
	if err == nil {
		t.Fatal("expected error for nil profile")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", connect.CodeOf(err))
	}
}

func TestUpdateProfile_NoAuth(t *testing.T) {
	h := setup(t)

	_, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: nil,
		Profile: &membav1.Profile{
			Address: "g1testuser",
			Bio:     "No auth",
		},
	}))
	if err == nil {
		t.Fatal("expected error for nil auth token")
	}
}

func TestUpdateProfile_ReadBackAfterUpdate(t *testing.T) {
	h := setup(t)
	addr := "g1roundtrip"
	token := h.makeToken(t, addr)

	// Update
	_, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: token,
		Profile: &membav1.Profile{
			Address: addr,
			Bio:     "Round-trip test",
			Github:  "samouraiworld",
			Website: "https://memba.app",
		},
	}))
	if err != nil {
		t.Fatal("update failed:", err)
	}

	// Read back
	resp, err := h.svc.GetProfile(t.Context(), connect.NewRequest(&membav1.GetProfileRequest{
		Address: addr,
	}))
	if err != nil {
		t.Fatal("get failed:", err)
	}
	if resp.Msg.Profile.Bio != "Round-trip test" {
		t.Fatalf("expected bio 'Round-trip test', got %q", resp.Msg.Profile.Bio)
	}
	if resp.Msg.Profile.Github != "samouraiworld" {
		t.Fatalf("expected github 'samouraiworld', got %q", resp.Msg.Profile.Github)
	}
	if resp.Msg.Profile.Website != "https://memba.app" {
		t.Fatalf("expected website 'https://memba.app', got %q", resp.Msg.Profile.Website)
	}
}

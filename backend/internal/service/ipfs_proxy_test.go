package service

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"
)

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

// buildUploadBody creates a multipart/form-data body with one "file" part carrying
// the given declared Content-Type and raw bytes. Returns the body and the outer
// multipart Content-Type header value to set on the request.
func buildUploadBody(t *testing.T, partContentType string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="file"; filename="upload.bin"`)
	if partContentType != "" {
		h.Set("Content-Type", partContentType)
	}
	part, err := mw.CreatePart(h)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, mw.FormDataContentType()
}

// pngBytes is a minimal valid PNG magic-signature (\x89PNG…) plus filler — passes the
// raster magic-byte sniff, so only the *other* checks under test can reject it.
func pngBytes(n int) []byte {
	sig := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	if n <= len(sig) {
		return sig
	}
	return append(sig, bytes.Repeat([]byte{0x00}, n-len(sig))...)
}

// ──────────────────────────────────────────────────────────────────────────────
// HandleIPFSUploadImage — /api/upload/image (5 MB, App Store media)
// ──────────────────────────────────────────────────────────────────────────────

func TestHandleIPFSUploadImage_MissingKey503(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "") // explicitly unconfigured

	body, ct := buildUploadBody(t, "image/png", pngBytes(64))
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing key: expected 503, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestHandleIPFSUploadImage_WrongMethod405(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "k")

	req := httptest.NewRequest(http.MethodGet, "/api/upload/image", nil)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong method: expected 405, got %d", rec.Code)
	}
}

func TestHandleIPFSUploadImage_NonImage400(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "k")

	body, ct := buildUploadBody(t, "text/plain", []byte("just some text, not an image"))
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-image: expected 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// Declared-type deny: an explicit image/svg+xml Content-Type must be rejected even
// though it carries the "image/" prefix — SVG is an active-content XSS vector.
func TestHandleIPFSUploadImage_DeclaredSVG400(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "k")

	// Body is a valid PNG — so ONLY the declared image/svg+xml type can trip the reject.
	body, ct := buildUploadBody(t, "image/svg+xml", pngBytes(64))
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("declared SVG: expected 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// Magic-byte deny: a PNG-labeled body whose bytes are actually SVG markup must be
// rejected — the declared Content-Type is attacker-controlled and can't be trusted.
func TestHandleIPFSUploadImage_PNGLabeledSVGBody400(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "k")

	svg := []byte("  \n\t<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")
	body, ct := buildUploadBody(t, "image/png", svg) // lies about being a PNG
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("magic-byte SVG: expected 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestHandleIPFSUploadImage_Oversize413(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "k")

	// > 5 MB (with margin over the multipart overhead allowance).
	body, ct := buildUploadBody(t, "image/png", pngBytes(5*1024*1024+128*1024))
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize: expected 413, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// Success path via the TEST-ONLY upload-URL seam: a valid PNG is streamed to an
// injected fake Lighthouse that returns a CID, and the handler echoes {"cid":…}.
// The seam (ipfsUploadOptions) is unexported, so no request/header/env can reach it.
func TestHandleIPFSUploadImage_ReturnsCID(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret-key")

	const wantCID = "QmTestCidReturnedByFakeLighthouse000000000000"
	var gotAuth string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"Hash": wantCID})
	}))
	defer fake.Close()

	body, ct := buildUploadBody(t, "image/png", pngBytes(256))
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage(ipfsUploadOptions{
		uploadURL:  fake.URL,
		httpClient: fake.Client(),
	}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("success: expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp struct {
		CID string `json:"cid"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (body=%q)", err, rec.Body.String())
	}
	if resp.CID != wantCID {
		t.Fatalf("expected cid %q, got %q", wantCID, resp.CID)
	}
	// The server-side secret bearer must have been attached to the upstream call —
	// proof the attacker-unreachable seam still wires the real auth to the fake.
	if gotAuth != "Bearer secret-key" {
		t.Fatalf("expected upstream Authorization 'Bearer secret-key', got %q", gotAuth)
	}
}

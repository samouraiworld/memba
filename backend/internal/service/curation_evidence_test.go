package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const evidenceCID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"

// pinned is what the fake Lighthouse received for one upload.
type pinned struct {
	auth, filename, contentType string
	body                        []byte
}

// fakeLighthouse answers every add with answer and status, and records what it was sent.
func fakeLighthouse(t *testing.T, status int, answer string) (ipfsUploadOptions, *pinned) {
	t.Helper()
	got := &pinned{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.auth = r.Header.Get("Authorization")
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Errorf("upstream form: %v", err)
			return
		}
		got.filename = header.Filename
		got.contentType = header.Header.Get("Content-Type")
		got.body, _ = io.ReadAll(file)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, answer)
	}))
	t.Cleanup(srv.Close)
	return ipfsUploadOptions{uploadURL: srv.URL}, got
}

func postEvidence(t *testing.T, h http.Handler, contentType string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/upload/curation-evidence", bytes.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var answer map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatalf("error body is not JSON: %q", rec.Body.String())
	}
	return answer["error"]
}

func TestCurationEvidence_PinsTheExactTextAndAnswersItsHash(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	opts, got := fakeLighthouse(t, http.StatusOK, `{"Hash":"`+evidenceCID+`"}`)
	text := []byte("\xef\xbb\xbfThe collection's art is original.\r\nSee the sketches.  ")

	rec := postEvidence(t, HandleCurationEvidenceUpload(opts), "text/plain; charset=UTF-8", text)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %q", rec.Code, rec.Body.String())
	}
	sum := sha256.Sum256(text)
	var answer map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer["cid"] != evidenceCID || answer["sha256"] != hex.EncodeToString(sum[:]) || len(answer) != 2 {
		t.Fatalf("answer %v", answer)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control %q", rec.Header().Get("Cache-Control"))
	}
	// Byte for byte, a byte order mark and trailing spaces included: the hash is of what was pinned.
	if !bytes.Equal(got.body, text) || got.filename != "evidence.txt" || got.contentType != "text/plain; charset=utf-8" || got.auth != "Bearer secret" {
		t.Fatalf("upstream got %+v", got)
	}
}

func TestCurationEvidence_AcceptsACIDv0(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	cid := "Qm" + strings.Repeat("a", 44)
	opts, _ := fakeLighthouse(t, http.StatusOK, `{"cid":"`+cid+`"}`)
	rec := postEvidence(t, HandleCurationEvidenceUpload(opts), "text/plain", []byte("A reason."))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), cid) {
		t.Fatalf("status %d, body %q", rec.Code, rec.Body.String())
	}
}

func TestCurationEvidence_RefusesWhatCouldNotBeCommittedOrShown(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	for _, tc := range []struct {
		name, contentType string
		body              []byte
		status            int
		message           string
	}{
		{"no content type", "", []byte("x"), http.StatusUnsupportedMediaType, "text/plain"},
		{"markup", "text/html", []byte("<p>x</p>"), http.StatusUnsupportedMediaType, "text/plain"},
		{"another charset", "text/plain; charset=latin1", []byte("x"), http.StatusUnsupportedMediaType, "text/plain"},
		{"empty", "text/plain", nil, http.StatusBadRequest, "evidence is empty"},
		{"blank", "text/plain", []byte(" \n\t "), http.StatusBadRequest, "evidence is empty"},
		{"not UTF-8", "text/plain", []byte{'a', 0xff, 'b'}, http.StatusBadRequest, "not valid UTF-8"},
		{"one byte too many", "text/plain", bytes.Repeat([]byte("a"), curationEvidenceMaxBytes+1), http.StatusRequestEntityTooLarge, "larger than 16 KB"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts, got := fakeLighthouse(t, http.StatusOK, `{"Hash":"`+evidenceCID+`"}`)
			rec := postEvidence(t, HandleCurationEvidenceUpload(opts), tc.contentType, tc.body)
			if rec.Code != tc.status || !strings.Contains(errorOf(t, rec), tc.message) {
				t.Fatalf("status %d, body %q; want %d with %q", rec.Code, rec.Body.String(), tc.status, tc.message)
			}
			if got.auth != "" {
				t.Fatal("a refused text reached the pinning service")
			}
		})
	}
}

func TestCurationEvidence_AcceptsExactly16KB(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	opts, got := fakeLighthouse(t, http.StatusOK, `{"Hash":"`+evidenceCID+`"}`)
	text := bytes.Repeat([]byte("é"), curationEvidenceMaxBytes/2)
	if rec := postEvidence(t, HandleCurationEvidenceUpload(opts), "text/plain", text); rec.Code != http.StatusOK || len(got.body) != curationEvidenceMaxBytes {
		t.Fatalf("status %d, %d bytes pinned", rec.Code, len(got.body))
	}
}

func TestCurationEvidence_ReportsAPinThatFailedOrAnsweredAnUnusableCID(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	for _, tc := range []struct {
		name, answer string
		status       int
		message      string
	}{
		{"refused", `{}`, http.StatusInternalServerError, "status 500"},
		{"no CID", `{}`, http.StatusOK, "returned no CID"},
		{"not JSON", `nope`, http.StatusOK, "failed to parse"},
		{"a CID the realm refuses", `{"Hash":"bafyTOOSHORT"}`, http.StatusOK, "unusable CID"},
		// A raw-leaves CIDv1: a valid CID, but not one the curation realm takes.
		{"a raw CIDv1", `{"Hash":"bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy"}`, http.StatusOK, "unusable CID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts, _ := fakeLighthouse(t, tc.status, tc.answer)
			rec := postEvidence(t, HandleCurationEvidenceUpload(opts), "text/plain", []byte("A reason."))
			if rec.Code != http.StatusBadGateway || !strings.Contains(errorOf(t, rec), tc.message) {
				t.Fatalf("status %d, body %q", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCurationEvidence_MethodAndConfiguration(t *testing.T) {
	t.Setenv("LIGHTHOUSE_API_KEY", "secret")
	req := httptest.NewRequest(http.MethodGet, "/api/upload/curation-evidence", nil)
	rec := httptest.NewRecorder()
	HandleCurationEvidenceUpload().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("GET: status %d, Allow %q", rec.Code, rec.Header().Get("Allow"))
	}

	t.Setenv("LIGHTHOUSE_API_KEY", "")
	if rec := postEvidence(t, HandleCurationEvidenceUpload(), "text/plain", []byte("x")); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no key: status %d", rec.Code)
	}
}

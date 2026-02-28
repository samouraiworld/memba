package service

import (
	"context"
	"database/sql"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// --- Input Validation Limits ---

const (
	maxBioLen    = 512
	maxFieldLen  = 128
	maxURLLen    = 256
	maxSocialLen = 256
)

// GetProfile returns a user's public profile. No authentication required.
func (s *MultisigService) GetProfile(ctx context.Context, req *connect.Request[membav1.GetProfileRequest]) (*connect.Response[membav1.GetProfileResponse], error) {
	addr := strings.TrimSpace(req.Msg.Address)
	if addr == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	profile, err := s.getProfileFromDB(addr)
	if err != nil {
		return nil, internalError("GetProfile", err)
	}

	return connect.NewResponse(&membav1.GetProfileResponse{
		Profile: profile,
	}), nil
}

// UpdateProfile updates the authenticated user's profile.
// The auth token's address must match the profile address.
func (s *MultisigService) UpdateProfile(ctx context.Context, req *connect.Request[membav1.UpdateProfileRequest]) (*connect.Response[membav1.UpdateProfileResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	p := req.Msg.Profile
	if p == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Auth check: user can only update their own profile
	if strings.TrimSpace(p.Address) != "" && p.Address != userAddr {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}
	p.Address = userAddr

	// Sanitize and validate fields
	p.Bio = sanitize(p.Bio, maxBioLen)
	p.Company = sanitize(p.Company, maxFieldLen)
	p.Title = sanitize(p.Title, maxFieldLen)
	p.AvatarUrl = sanitizeURL(p.AvatarUrl, maxURLLen)
	p.Twitter = sanitize(p.Twitter, maxSocialLen)
	p.Github = sanitize(p.Github, maxSocialLen)
	p.Website = sanitizeURL(p.Website, maxURLLen)

	now := time.Now().UTC().Format(time.RFC3339)

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO profiles (address, bio, company, title, avatar_url, twitter, github, website, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(address) DO UPDATE SET
			bio = excluded.bio,
			company = excluded.company,
			title = excluded.title,
			avatar_url = excluded.avatar_url,
			twitter = excluded.twitter,
			github = excluded.github,
			website = excluded.website,
			updated_at = excluded.updated_at
	`, p.Address, p.Bio, p.Company, p.Title, p.AvatarUrl, p.Twitter, p.Github, p.Website, now)
	if err != nil {
		return nil, internalError("UpdateProfile", err)
	}

	p.UpdatedAt = now

	return connect.NewResponse(&membav1.UpdateProfileResponse{
		Profile: p,
	}), nil
}

// --- Helpers ---

// getProfileFromDB reads a profile from SQLite, returning an empty Profile if not found.
func (s *MultisigService) getProfileFromDB(address string) (*membav1.Profile, error) {
	p := &membav1.Profile{Address: address}

	err := s.db.QueryRow(`
		SELECT bio, company, title, avatar_url, twitter, github, website, updated_at
		FROM profiles WHERE address = ?
	`, address).Scan(&p.Bio, &p.Company, &p.Title, &p.AvatarUrl, &p.Twitter, &p.Github, &p.Website, &p.UpdatedAt)

	if err == sql.ErrNoRows {
		return p, nil // empty profile — not an error
	}
	return p, err
}

// sanitize strips HTML tags and truncates to maxLen runes.
func sanitize(s string, maxLen int) string {
	s = stripHTML(strings.TrimSpace(s))
	if utf8.RuneCountInString(s) > maxLen {
		runes := []rune(s)
		s = string(runes[:maxLen])
	}
	return s
}

// sanitizeURL validates a URL and returns it or empty string if invalid.
func sanitizeURL(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) > maxLen {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return s
}

// stripHTML removes HTML/XML tags from a string (basic sanitization).
func stripHTML(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			b.WriteRune(r)
		}
	}
	return b.String()
}

package launchpadindex

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const maxRPCBody = 8 << 20

var ErrInvalidRPCSource = errors.New("invalid pinned Launchpad RPC source")

// PinnedRPCSource always sends every request to one configured endpoint. A
// proxy or load balancer behind that URL remains an explicit trust boundary.
type PinnedRPCSource struct {
	base   url.URL
	client *http.Client
}

func NewPinnedRPCSource(rawURL string, client *http.Client) (*PinnedRPCSource, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, ErrInvalidRPCSource
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return ErrInvalidRPCSource
	}
	return &PinnedRPCSource{base: *parsed, client: &clientCopy}, nil
}

func (s *PinnedRPCSource) get(ctx context.Context, path string, height int64) ([]byte, error) {
	query := url.Values{}
	if height > 0 {
		query.Set("height", strconv.FormatInt(height, 10))
	}
	return s.getQuery(ctx, path, query)
}

func (s *PinnedRPCSource) getQuery(ctx context.Context, path string, query url.Values) ([]byte, error) {
	if s == nil || s.client == nil {
		return nil, ErrInvalidRPCSource
	}
	requestURL := s.base
	requestURL.Path = path
	requestURL.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("launchpad RPC %s returned HTTP %d", path, response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxRPCBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxRPCBody {
		return nil, fmt.Errorf("launchpad RPC %s response too large", path)
	}
	return body, nil
}

func (s *PinnedRPCSource) status(ctx context.Context) ([]byte, error) {
	return s.get(ctx, "/status", 0)
}

func (s *PinnedRPCSource) block(ctx context.Context, height int64) ([]byte, error) {
	if height <= 0 {
		return nil, ErrInvalidBlockHeader
	}
	return s.get(ctx, "/block", height)
}

func (s *PinnedRPCSource) results(ctx context.Context, height int64) ([]byte, error) {
	if height <= 0 {
		return nil, ErrInvalidBlock
	}
	return s.get(ctx, "/block_results", height)
}

func (s *PinnedRPCSource) transaction(ctx context.Context, hash [32]byte) ([]byte, error) {
	if hash == ([32]byte{}) {
		return nil, ErrInvalidRPCSource
	}
	return s.getQuery(ctx, "/tx", url.Values{"hash": {"0x" + hex.EncodeToString(hash[:])}})
}

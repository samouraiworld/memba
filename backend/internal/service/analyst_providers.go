package service

import (
	"sync"
	"time"
)

// ── Provider Health Tracking ─────────────────────────────────

// providerHealth tracks failure rates for circuit-breaker logic.
type providerHealth struct {
	mu       sync.RWMutex
	failures map[string]*failureRecord
}

type failureRecord struct {
	count      int
	lastFailed time.Time
	retryAfter time.Time // parsed from 429 Retry-After headers
}

var health = &providerHealth{
	failures: make(map[string]*failureRecord),
}

const (
	// Circuit opens after this many consecutive failures.
	circuitBreakerThreshold = 3
	// Circuit resets (half-open) after this duration.
	circuitBreakerCooldown = 2 * time.Minute
)

// recordFailure increments the failure count for a provider.
func (h *providerHealth) recordFailure(providerName string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	rec, ok := h.failures[providerName]
	if !ok {
		rec = &failureRecord{}
		h.failures[providerName] = rec
	}
	rec.count++
	rec.lastFailed = time.Now()
}

// recordSuccess resets the failure count for a provider.
func (h *providerHealth) recordSuccess(providerName string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.failures, providerName)
}

// setRetryAfter records a 429 Retry-After time.
func (h *providerHealth) setRetryAfter(providerName string, retryAt time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()

	rec, ok := h.failures[providerName]
	if !ok {
		rec = &failureRecord{}
		h.failures[providerName] = rec
	}
	rec.retryAfter = retryAt
}

// isHealthy returns true if the provider should be attempted.
func (h *providerHealth) isHealthy(providerName string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()

	rec, ok := h.failures[providerName]
	if !ok {
		return true
	}

	// Respect Retry-After
	if !rec.retryAfter.IsZero() && time.Now().Before(rec.retryAfter) {
		return false
	}

	// Circuit breaker: open if too many failures, but allow retry after cooldown
	if rec.count >= circuitBreakerThreshold {
		return time.Since(rec.lastFailed) > circuitBreakerCooldown
	}

	return true
}

// selectProvider picks the best available provider for a given index.
// Prioritizes model diversity via round-robin, skipping unhealthy providers.
func selectProvider(providers []LLMProvider, index int) (LLMProvider, int) {
	n := len(providers)
	for attempt := 0; attempt < n; attempt++ {
		idx := (index + attempt) % n
		if health.isHealthy(providers[idx].Name) {
			return providers[idx], idx
		}
	}
	// All unhealthy — try the requested one anyway (half-open circuit)
	return providers[index%n], index % n
}

// selectFallback picks the next healthy provider after the given index.
func selectFallback(providers []LLMProvider, failedIndex int) (LLMProvider, bool) {
	n := len(providers)
	for attempt := 1; attempt < n; attempt++ {
		idx := (failedIndex + attempt) % n
		if health.isHealthy(providers[idx].Name) {
			return providers[idx], true
		}
	}
	return LLMProvider{}, false
}

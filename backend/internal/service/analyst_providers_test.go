package service

import (
	"testing"
	"time"
)

func TestProviderHealthBasic(t *testing.T) {
	h := &providerHealth{failures: make(map[string]*failureRecord)}

	if !h.isHealthy("groq") {
		t.Error("new provider should be healthy")
	}

	h.recordFailure("groq")
	if !h.isHealthy("groq") {
		t.Error("should be healthy after 1 failure")
	}

	h.recordSuccess("groq")
	if !h.isHealthy("groq") {
		t.Error("should be healthy after success reset")
	}
}

func TestProviderHealthCircuitBreaker(t *testing.T) {
	h := &providerHealth{failures: make(map[string]*failureRecord)}

	for i := 0; i < circuitBreakerThreshold; i++ {
		h.recordFailure("google")
	}

	if h.isHealthy("google") {
		t.Error("should be unhealthy after hitting threshold")
	}

	// After cooldown, should be half-open (healthy again for retry)
	h.mu.Lock()
	h.failures["google"].lastFailed = time.Now().Add(-circuitBreakerCooldown - time.Second)
	h.mu.Unlock()

	if !h.isHealthy("google") {
		t.Error("should be healthy (half-open) after cooldown")
	}
}

func TestProviderHealthRetryAfter(t *testing.T) {
	h := &providerHealth{failures: make(map[string]*failureRecord)}

	h.setRetryAfter("together", time.Now().Add(30*time.Second))

	if h.isHealthy("together") {
		t.Error("should be unhealthy while Retry-After is active")
	}

	h.setRetryAfter("together", time.Now().Add(-1*time.Second))

	if !h.isHealthy("together") {
		t.Error("should be healthy after Retry-After expires")
	}
}

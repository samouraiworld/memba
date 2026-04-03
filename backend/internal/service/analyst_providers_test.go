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

func TestSelectProvider(t *testing.T) {
	providers := []LLMProvider{
		{Name: "groq", Model: "llama"},
		{Name: "google", Model: "gemini"},
		{Name: "together", Model: "mistral"},
	}

	health = &providerHealth{failures: make(map[string]*failureRecord)}

	p0, _ := selectProvider(providers, 0)
	p1, _ := selectProvider(providers, 1)
	p2, _ := selectProvider(providers, 2)

	if p0.Name != "groq" || p1.Name != "google" || p2.Name != "together" {
		t.Errorf("expected round-robin: groq, google, together; got %s, %s, %s",
			p0.Name, p1.Name, p2.Name)
	}
}

func TestSelectProviderSkipsUnhealthy(t *testing.T) {
	providers := []LLMProvider{
		{Name: "groq", Model: "llama"},
		{Name: "google", Model: "gemini"},
		{Name: "together", Model: "mistral"},
	}

	health = &providerHealth{failures: make(map[string]*failureRecord)}
	for i := 0; i < circuitBreakerThreshold; i++ {
		health.recordFailure("groq")
	}

	p, _ := selectProvider(providers, 0)
	if p.Name != "google" {
		t.Errorf("expected google (skip unhealthy groq), got %s", p.Name)
	}
}

func TestSelectFallback(t *testing.T) {
	providers := []LLMProvider{
		{Name: "groq", Model: "llama"},
		{Name: "google", Model: "gemini"},
		{Name: "together", Model: "mistral"},
	}

	health = &providerHealth{failures: make(map[string]*failureRecord)}

	fallback, ok := selectFallback(providers, 0)
	if !ok || fallback.Name != "google" {
		t.Errorf("expected google fallback, got %s (ok=%v)", fallback.Name, ok)
	}

	for i := 0; i < circuitBreakerThreshold; i++ {
		health.recordFailure("google")
	}

	fallback, ok = selectFallback(providers, 0)
	if !ok || fallback.Name != "together" {
		t.Errorf("expected together fallback, got %s (ok=%v)", fallback.Name, ok)
	}
}

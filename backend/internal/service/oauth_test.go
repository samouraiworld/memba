package service

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestOAuthStateStore_GenerateReturns64CharHex(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := NewOAuthStateStore(ctx)

	token, err := store.Generate()
	if err != nil {
		t.Fatalf("Generate() returned error: %v", err)
	}
	if len(token) != 64 {
		t.Errorf("expected 64-char hex token, got %d chars: %s", len(token), token)
	}
}

func TestOAuthStateStore_ValidateConsumesToken(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := NewOAuthStateStore(ctx)

	token, _ := store.Generate()

	// First validation should succeed
	if !store.Validate(token) {
		t.Fatal("first Validate() should return true")
	}

	// Second validation should fail (one-time use)
	if store.Validate(token) {
		t.Fatal("second Validate() should return false (token consumed)")
	}
}

func TestOAuthStateStore_ValidateRejectsExpiredToken(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := NewOAuthStateStore(ctx)

	// Manually insert an expired token
	store.mu.Lock()
	store.entries["expired_token"] = oauthStateEntry{expiry: time.Now().Add(-1 * time.Minute)}
	store.mu.Unlock()

	if store.Validate("expired_token") {
		t.Fatal("Validate() should reject expired token")
	}
}

func TestOAuthStateStore_ValidateRejectsUnknownToken(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := NewOAuthStateStore(ctx)

	if store.Validate("nonexistent_token_abc123") {
		t.Fatal("Validate() should reject unknown token")
	}
}

func TestOAuthStateStore_ConcurrentAccess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := NewOAuthStateStore(ctx)

	const goroutines = 50
	var wg sync.WaitGroup
	tokens := make(chan string, goroutines)

	// Generate tokens concurrently
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			token, err := store.Generate()
			if err != nil {
				t.Errorf("concurrent Generate() failed: %v", err)
				return
			}
			tokens <- token
		}()
	}
	wg.Wait()
	close(tokens)

	// Validate all tokens — each should succeed exactly once
	for token := range tokens {
		if !store.Validate(token) {
			t.Errorf("Validate(%s) should return true", token[:8])
		}
	}
}

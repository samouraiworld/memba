package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
)

// Trusted operator input only; no env parser or enabled/default configuration.
// Cost.Target and Budget.Signer are the sole source of transport/publisher scope.
type arcadeFreePlayConfig struct {
	Cost                                     arcade.FreePlayCostSettings
	Budget                                   arcade.FreePlayBudgetSettings
	RPCURL                                   string
	RPCBlockAge, RPCTimeout, PublishInterval time.Duration
	Publish                                  bool
	Limits                                   arcadeFreePlayLimits
	Node                                     arcade.Config
}
type arcadeFreePlayDependencies struct {
	Database  *sql.DB
	Auth      arcade.FreePlayAuthenticator
	Parent    *arcade.Runner
	HTTP      *http.Client
	Broadcast arcade.FreePlayBroadcastFunc
}
type arcadeFreePlayRuntime struct {
	handler    http.Handler
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	stopping   bool
	requests   sync.WaitGroup
	background sync.WaitGroup
	child      *arcade.FreePlayRunner
	limiter    *arcadeFreePlayLimiter
	// Concrete instances retained for composition inspection; never rebuilt per request.
	store     *arcade.FreePlayStore
	cost      *arcade.FreePlayCostPolicy
	spending  *arcade.FreePlayBudgetSpending
	chain     *arcade.FreePlayRPCChain
	publisher *arcade.FreePlayPublisher
}

func validArcadeFreePlayNode(cfg arcade.Config) bool {
	return cfg.NodeBin != "" && cfg.Timeout > 0 && cfg.Concurrency > 0 && cfg.MaxOutputBytes > 0
}
func newArcadeFreePlayRuntime(parent context.Context, cfg *arcadeFreePlayConfig, deps arcadeFreePlayDependencies) (*arcadeFreePlayRuntime, error) {
	ctx, cancel := context.WithCancel(parent)
	r := &arcadeFreePlayRuntime{ctx: ctx, cancel: cancel, handler: http.NotFoundHandler()}
	// Nil is the initial main wiring: no DB/prices/Node/limiter/signer/publisher work.
	if cfg == nil {
		return r, nil
	}
	settings := *cfg
	fail := func(err error) (*arcadeFreePlayRuntime, error) {
		cancel()
		if r.limiter != nil {
			<-r.limiter.done
		}
		if r.child != nil {
			_ = r.child.Close()
		}
		return nil, err
	}
	if deps.Database == nil || deps.Auth == nil || deps.Parent == nil || !validArcadeFreePlayNode(settings.Node) || settings.PublishInterval <= 0 {
		return fail(arcade.ErrFreePlayPaused)
	}
	var err error
	r.store, err = arcade.NewFreePlayStore(deps.Database, settings.Cost.Target)
	if err != nil {
		return fail(err)
	}
	budget, err := arcade.NewFreePlayBudget(r.store, settings.Budget, nil)
	if err != nil {
		return fail(err)
	}
	prices, err := arcade.NewFreePlayRPCPrices(settings.RPCURL, settings.Cost.Target, deps.HTTP, settings.RPCBlockAge, nil)
	if err != nil {
		return fail(err)
	}
	r.cost, err = arcade.NewFreePlayCostPolicy(settings.Cost, prices, budget.CanQuote, nil)
	if err != nil {
		return fail(err)
	}
	r.spending, err = arcade.NewFreePlayBudgetSpending(budget, r.cost)
	if err != nil {
		return fail(err)
	}
	r.chain, err = arcade.NewFreePlayRPCChain(arcade.FreePlayChainConfig{Enabled: settings.Publish, Target: settings.Cost.Target, RPCURL: settings.RPCURL, Signer: settings.Budget.Signer, GasWanted: settings.Cost.GasWanted, MaxFeeUgnot: settings.Cost.MaxFeeUgnot, MaxDepositUgnot: settings.Cost.MaxDepositUgnot, Timeout: settings.RPCTimeout}, deps.HTTP, deps.Broadcast, r.cost)
	if err != nil {
		return fail(err)
	}
	r.child, err = arcade.NewFreePlayRunner(deps.Parent)
	if err != nil {
		return fail(err)
	}
	r.limiter, err = newArcadeFreePlayLimiter(ctx, settings.Limits)
	if err != nil {
		return fail(err)
	}
	r.handler = r.limiter.wrap(arcade.NewFreePlayHandler(arcade.FreePlayHTTPConfig{Enabled: true, Target: settings.Cost.Target, Store: r.store, Auth: deps.Auth, Limiter: r.limiter, Quotes: r.cost, Boards: r.chain, Verifier: r.child}))
	if settings.Publish {
		r.publisher = &arcade.FreePlayPublisher{Enabled: true, Signer: settings.Budget.Signer, Store: r.store, Chain: r.chain, Spending: r.spending}
		r.background.Add(1)
		go func() {
			defer r.background.Done()
			ticker := time.NewTicker(settings.PublishInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					_, _ = r.publisher.PublishOne(ctx)
				}
			}
		}()
	}
	return r, nil
}

// Wrap the complete HTTP handler once, preserving the original ResponseWriter.
// Drain tracks admitted HTTP requests plus background work owned by this runtime;
// it does not track independent goroutines started by other subsystems.
func (r *arcadeFreePlayRuntime) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		r.mu.Lock()
		if r.stopping {
			r.mu.Unlock()
			http.Error(w, "shutting_down", http.StatusServiceUnavailable)
			return
		}
		r.requests.Add(1)
		r.mu.Unlock()
		defer r.requests.Done()
		ctx, cancel := context.WithCancel(request.Context())
		stop := context.AfterFunc(r.ctx, cancel)
		defer func() { stop(); cancel() }()
		if r.ctx.Err() != nil {
			cancel()
		}
		next.ServeHTTP(w, request.WithContext(ctx))
	})
}
func (r *arcadeFreePlayRuntime) stop() { r.mu.Lock(); r.stopping = true; r.mu.Unlock(); r.cancel() }
func (r *arcadeFreePlayRuntime) drain(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		r.requests.Wait()
		r.background.Wait()
		if r.limiter != nil {
			<-r.limiter.done
		}
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Shutdown includes the forced HTTP-close path. Failure to drain must prevent
// bundle cleanup/checkpoint/DB-close; main terminates without those operations.
func shutdownArcadeHTTP(server *http.Server, runtime *arcadeFreePlayRuntime, parent *arcade.Runner, timeout time.Duration) error {
	runtime.stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	err := server.Shutdown(shutdownCtx)
	cancel()
	if err != nil {
		if closeErr := server.Close(); closeErr != nil {
			return errors.Join(err, closeErr)
		}
	}
	drainCtx, cancelDrain := context.WithTimeout(context.Background(), timeout)
	defer cancelDrain()
	if err = runtime.drain(drainCtx); err != nil {
		return err
	}
	if runtime.child != nil {
		if err = runtime.child.Close(); err != nil {
			return err
		}
	}
	if parent != nil {
		return parent.Close()
	}
	return nil
}

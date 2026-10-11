# Free play quotes and durable allowance (preparation only)

This source is dormant. It does not start a worker, expose routes, select a key,
sign, or change legacy Daily pricing. No production numerical limits are provided.

## Explicit composition

1. Supply one approved target, dedicated signer, RPC origin and daily allowance.
2. Construct `NewFreePlayBudget(store, dailySettings, clock)` using the same SQLite
   database as the publisher and all writers for that signer.
3. Construct `NewFreePlayRPCPrices` with that target, explicit acceptable block age
   and bounded HTTP client. It checks node identity and freshness on both sides of
   uncached price reads. Native price queries do not provide an atomic block proof.
4. Construct `NewFreePlayCostPolicy(costSettings, prices, budget.CanQuote, clock)`.
   Gas wanted, storage byte upper bound, fee margin, per-attempt caps, price age and
   quote lifetime all require reviewed explicit values. Rehearsal measurements do
   not establish worst-case upper bounds. Fee uses exact rational ceil; deposit
   uses the full approved byte bound. No price or amount falls back to v1 defaults.
5. Construct `NewFreePlayBudgetSpending(budget, costPolicy)` for the publisher.
   Inject that same cost policy into the transport's structural
   `ValidateBroadcast(ctx, target, entry, quote, gasWanted) error` guard and use
   identical gas wanted, target, signer and approved caps in the transport.

Quotes show studio-paid maximum fee and deposit separately. Availability at quote
issuance is advisory; a later reservation may refuse if capacity was consumed.
Fresh prices are checked before reservation and again by the transport immediately
before its own final expiry/context check. Price increases beyond the consented
quote require a new authorization; there is no hidden increase or wallet fallback.

## Durable reservation

The reserved additive migration `043_arcade_freeplay_spending_v2.sql` depends on
042. `db.Migrate` applies it automatically even while Free play is disabled. This
is a database rollout change: specific owner approval, a verified backup and a
reviewed rollback procedure are required before merge/deployment. Rolling the
binary back does not undo the migration; preserve journal/counter data. No live
migration is performed by this preparation. Constructors never create tables;
missing schema prevents availability checks and reservations.

Counters aggregate by chain, signer and UTC day across games and realms sharing
this database. The first reservation fixes that day's approved maximum attempts,
fees and deposits; differing process settings refuse rather than silently alter
those caps. Counter and immutable reservation journal are written in one SQLite
transaction, after acquiring the real writer and re-reading the clock. Exact
stored consumed quote, run payload, queued outbox and matching live signer/outbox
leases are required. Expiry and UTC day are checked again before commit.

The existing spending interface does not carry a caller lease token. Its check
proves live matching leases, while the publisher separately fences the actual
caller token before durable broadcast intent. A stale caller could conservatively
consume allowance, but cannot thereby bypass the publisher's broadcast fence.

Every successful reservation remains charged, including cancellation, expiry after
commit or an ambiguous send. It is an allowance reservation, not a claim of actual
onchain expense. There is no automatic refund. A failed/ambiguous database commit
must never cause broadcasting; the publisher already stops on a reservation error.

Activation, funding, database backup/migration rollout and numeric limits remain a
separate owner-approved operation. Separate databases cannot enforce a shared
signer quota; all writers must share this database and the A2 signer lease.

Price RPC origins require HTTPS outside literal `localhost`, `127.0.0.1` or
`[::1]` HTTP loopback. Construction validates this before any RPC; an explicit
remote HTTP URL is not sufficient authorization to use an unauthenticated price
transport. No hostname suffix or IP alias bypass is allowed.

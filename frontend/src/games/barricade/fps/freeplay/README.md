> **A8 intégré par Git depuis `35c9e9205bb7726e7a47ef913908296cff0de2e2`.**
> Le wrapper utilise maintenant `runtime.tsx`. Ce delta C attend sa validation ciblée
> au créneau alloué ; les preuves A3 antérieures ne valident pas A8.

# FPS Free play consumer — injected, no default publication

`FpsPreview` now owns the real run consumer. `Barricade` exposes an optional
`fpsFreePlay` bridge and passes it only to its opt-in FPS preview. Without that
bridge there is no shared API session or network call. There is no backend,
shared-client, wallet or LaunchContext edit. Classic remains independent.

The backend verifies the **exact TS engine in a bounded Node worker**. A owns
strict Free play dispatch and the Go envelope, not a Go rewrite of the engine.
The worker/envelope must validate the supplied fixtures before activation.

## Inject the existing A implementation

The wrapper consumes a stable `games.barricade` configuration from the shared
provider. An explicit stable bridge may also be passed as `fpsFreePlay` to
Barricade, or `freePlay` to FpsPreview:

```tsx
const fpsBridge = makeFpsRuntimeBridge({
    rules: 'barricade-fps-c1', simVersion: 3,
    storage, client, connect,
})
```

This adapter uses the integrated A8 guard and panels for both terminal and saved
results. A custom lower-level bridge must preserve the same recovery contract.

The `client` above is A's injected client with its existing trusted endpoint,
network target and identity adapter. No such client/default endpoint is created
here. Keep storage stable for the mounted game; A handles identity changes inside its session. A bridge replacement or explicit disable disposes the previous result, fences late handles and retains the same game session, UUID and terminal log. A alone owns auth, verify/quote/confirm, publication persistence,
retry/outbox and receipt validation. Opening its result panel does not call any
API action. It restores saved receipts as untrusted and requires fresh reads.

## Game identity, checkpoints and lifecycle

`createFpsRunConsumer` allocates a lowercase UUID v4 at a new run, stores a local
checkpoint on mount and retains it across pause/reload/retry. Restart creates a
new UUID and session. Each local record is under
`memba:barricade:fps:local:v1:<uuid>`; `memba:barricade:fps:active:v1` is only the
resume pointer. These are game checkpoints, not a duplicate of A's publication
storage. Completed local checkpoints are retained without automatic pruning. Saved publication results are recovered separately from A’s bounded canonical index.

Checkpoint accepted journals about once per simulated second and at safe pause
or terminal boundaries. A pointer action can occur at the current tick before
`advance`: that pending tail is not misrepresented as a completed tick. Until
advance consumes it, keep the preceding consistent checkpoint. Abrupt close can
therefore lose the latest uncheckpointed fraction of play; no extra simulation
tick is invented. A valid recovered nonterminal run resumes **paused**, with aim
reset to centre. Complete recovered runs remain complete under the same UUID.
Malformed stored input is not trusted: recovery validates accepted actions and
falls back to a new local run if invalid.

On terminal notification, the consumer captures the real session journal,
replays it strictly, freezes primitive input before awaiting commitments, then
calls the injected A snapshot/session factory. A's constructor persists the
snapshot before the result panel is made available. UUID/terminal journal stay
unchanged on retry. No verify, quote, publish or refresh is automatic.

Storage or preparation failure preserves the in-memory final score and export,
shows a retry action and does not erase the run. Exports retain the original
replay fields plus `clientRunId`. If storage is unavailable, the user must retain
the window or export; durable recovery cannot be promised. Closing/restarting
pauses/clears input, unsubscribes and disposes A's handle. A generation guard
disposes handles arriving late after closure or replacement, including React
effect detach/remount. A remains responsible for aborting its own in-flight I/O.

`consumer.test.ts` produces a **new live winning run** through normal session
commands, interspersed with full-magazine reloads, same-tick fire and duplicate
repair/continue attempts. Its real accepted journal is compared to the terminal
codec/state and the injected snapshot. This tests the assembly beyond fixtures.
Directions are copied on admission and export; JavaScript signed zero becomes
integer zero, preserving simulation semantics and the canonical wire contract.

## Codec for A's bounded Node worker and Go envelope

- Game `barricade`, rules `barricade-fps-c1`, simVersion `3` (C1 engine unchanged).
- Codec `barricade-fps-inputs-v1`.
- Seed: nonempty ASCII `[a-zA-Z0-9:_-]`, at most 128 characters/bytes. This
  certification subset avoids ambiguous Unicode seed/JSON encodings; gameplay
  debug logs outside it remain local/exportable, not silently rewritten.
- Wire is a JSON array `[finalTick, events]`, with no spaces in canonical output.
  Event rows: `[tick,"F",x,y,z]`, `[tick,"R"]` reload, `[tick,"P"]` patch,
  `[tick,"C"]` continue. Exact row arity; all numeric values are integers,
  negative zero rejected, directions in [-10000,10000] with z <= -1000.
- `0 < finalTick <= 10800`, at most 20000 events, encoded transcript <=1,000,000
  ASCII bytes. Tick order is nondecreasing and every tick < finalTick. Preserve
  the submitted order for actions at the same tick (e.g. patch then continue).
- Decode may accept JSON whitespace and equivalent numeric spellings; reconstruct
  decimal integer rows before hashing. No hash of incoming raw JSON formatting.
- For each tick, apply that tick's actions in order, then advance once. Reject an
  action when `apply` returns the unchanged state: no-op reload, cooldown fire,
  duplicate patch etc cannot become accepted journal entries. C1's partial debug
  `replay()` remains unchanged; this stricter publication verifier is separate.
- Stop exactly at the declared terminal tick, and reject unconsumed/trailing input
  or a nonterminal ending. `finishReason` is `won` or `lost`; score is recalculated.

## Commitments

Use A's `H(fields...) = SHA256(uint32_be(UTF8_length) || UTF8(field) ...)`:

```
stateHash = H("memba:barricade-fps-state:v1", canonicalState)
replayHash = H("memba:free-replay:v1", "barricade", "barricade-fps-c1", "3",
               seed, "barricade-fps-inputs-v1", canonicalReplay)
```

The exact state string is the compact JSON array from `sim/fps/replay.ts`:

```
[rules, version, seed, tick, rng, phase, wave, waveStarted, spawned, nextId,
 hp, ammo, reloadUntil, fireAt, repairUntil, patchAvailable, score, kills, shots,
 [[enemy.id, enemy.axis, enemy.kind, enemy.progress, enemy.speed, enemy.hp], ...]]
```

Keep enemy array order, explicit false/true and empty arrays. No floating-point
values or implicit object field order enter the commitment. This is a new
64-hex cryptographic diagnostic/preparation value, distinct from C1's local
16-hex FNV digest. A computes runID and payloadHash using its existing contract;
there are no replacements here. No registry activation is included.

## Worker/envelope conformance and fixtures

`sim/fps/{types,engine,collision,replay}.ts` are untouched from C1. The worker must execute that exact engine; envelope/commitment code must preserve
unsigned uint32 FNV/xorshift arithmetic, fallback nonzero RNG, truncation toward
zero in millimetre interpolation, the exact integer shield window and rational
slab comparisons (cross products), nearest intersection and smaller enemy ID on
exact distance ties. The camera's trigonometry/interpolation is not authority.
Wave transitions, repair timeout, reload/cooldown, rejected actions and the
10800-tick loss rule must match the source order. Static scenery is decorative.

`fixtures/terminal-vectors.json` contains complete envelope/canonical replay,
score/reason, canonical terminal state, stateHash and replayHash for:

- a real C1 exported winning run with damage, repair, reload and same-tick actions;
- a deterministic unattended terminal loss with surviving enemies in the state.

`fixtures/won-repair.json` preserves the source debug journal for audit. The
terminal test uses an independent Node SHA256/LP implementation for expected
vectors and checks JSON normalization, invalid order/arity/direction, rejected
commands, incomplete/trailing runs, immutable capture across await and UUID/hash
validation. To deliberately regenerate vectors after an approved codec change:

```
UPDATE_FPS_FIXTURES=1 node node_modules/vitest/vitest.mjs run src/games/barricade/fps/freeplay/terminal.test.ts --maxWorkers=1 --no-file-parallelism
```

Normal tests never regenerate them. A's Node-worker dispatch and Go-envelope conformance against these fixtures are
still required. No end-to-end publication or receipt is claimed.

## Older saved results (A3)

From ready, pause or terminal, explicitly open “Résultats sauvegardés”. The bridge
uses only A3 list/load APIs: at most20 Barricade snapshots, filtered to the exact
FPS rules/version. No duplicate index or storage scan. An ID can recover a record
outside the recent index. Missing/corrupt records and a corrupt index are shown
separately; ID recovery remains available if the index fails.

Opening creates A’s session directly from its canonical snapshot, without
terminal replay, hashing, starting a game, replacing the active UUID or invoking
an API. A revalidates the stored envelope and persists it. A saved receipt stays
in phase `saved`, visibly “Saved receipt”, until explicit “Check saved result”.
Close, changing selected result and component unmount dispose the shared session.
No latest-result lookup or refresh runs automatically.

Run the opt-in real-source assembly with:

```sh
node src/games/barricade/fps/freeplay/real-a3.integration.mjs
```

It verifies the A8 dependency is an ancestor of HEAD, then bundles directly against
the integrated A snapshot/index/session/result/client modules (no copies), and
uses a local fake HTTP transport. It checks no API/token/hash on recovery, current
game preservation, Saved -> explicit refresh -> confirmed through the real client’s
commitment validation, missing/corrupt/wrong-version records and disposal. No
wallet, signature, chain publication or live backend is exercised.

## External selection and integrated A8 provider

`Barricade` accepts `recovery?: {clientRunId,onClose} | null` and nullable
`fpsFreePlay`. Recovery is a sibling overlay of the current Classic/FPS engine:
it never changes the query, starts a game or replaces the mounted engine. Existing
window-activity handling pauses gameplay; closing does not auto-resume. The game
behind the archive is inert. Selection replacement/unmount disposes A’s session.

Per D’s integration decision, **global provider recovery is ignored**. Arcade >
Your runs owns its local SavedRunPanel without mounting an engine. These optional
Barricade props remain a local-only recovery entry for a deliberate owner. There
is no selection broadcast/listener.

A8 is merged normally. `runtime.tsx` is imported by Barricade and
`useFpsRuntime(props)` supplies the injected bridge. Shell/WindowBody/runtime
lifecycle remains owned by D/Lead; no other module here owns it.

The hook uses only `runtime.games.barricade`; exact FPS rules/version are required.
Explicit bridge props win; null disables fallback. Recovery comes only from the
explicit local prop, including null. No endpoint/realm/network/flag is invented.
Without a client the adapter still saves to A’s canonical store/index and
shows an unconfirmed local result; optional wallet connection requires a click.
With a client it uses A’s actual session and result UI. Existing consent/receipt
is retained when preparing the same completed run again.

`FPS_A3_TYPES=1 node src/games/barricade/fps/freeplay/real-a3.integration.mjs`
checks strict adapter types and the real provider/session/client assembly against
the integrated sources. `runtime.test.tsx` adds DOM coverage of the consumer's
Connect wiring and storage failure paths. These commands await the C slot.
No real Shell/browser or wallet publication is claimed by these tests.

## A8 — résultat terminal avant Connect

Le runtime délègue la persistance canonique/index et sa relecture à
`prepareFreePlayRecovery`. Plus de comparaison/persistance locale dupliquant ce
guard. Le constructeur A confirme également la persistance de ses sessions.
`FreePlayResult` reçoit le callback `connect` explicite et conserve son
`session.prepareRecovery`/`view.recoveryReady`. Le mode local fournit au composant
partagé `FreePlayConnect` un callback stable par handle vers le même guard A,
qui refuse également un handle déjà disposé. Ce callback est reconfirmé par A au
clic avant de laisser Connect démonter la fenêtre.

`LocalResult` est seulement présentatif : aucun appel Connect, aucune promesse de
reprise de moteur. Avec connexion disponible, le panneau A possède le message,
le guard au clic, le coalescing, l’échec et l’export canonique. Sans connexion,
un échec initial de stockage affiche une explication/export du snapshot local ;
le résultat n’est pas annoncé sauvegardé. Les conflits restent des erreurs, jamais
une réattribution de binding/consentement. L’export replay du parent reste distinct.

Validation ciblée, **à exécuter uniquement au créneau C attribué** :

```sh
FPS_A3_TYPES=1 node src/games/barricade/fps/freeplay/real-a3.integration.mjs
```

Le script importe directement les modules intégrés et prépare deux cas consumer
d’écriture silencieuse (canonical/index) : erreur/export, pas de faux succès,
UUID conservé. Les interactions DOM Connect/quota-au-clic, guest→member/bureaux,
A→B et maintien du moteur à owner constant restent pour le slot de composition.
Au premier échec de guard, l’export ne peut contenir que le snapshot effectivement
capturé ; ne pas promettre la récupération de champs plus récents que le stockage
n’a pas pu restituer. Vérifier ce cas avec A lors de la composition exacte.

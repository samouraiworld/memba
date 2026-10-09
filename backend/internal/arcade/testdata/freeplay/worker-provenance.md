# Free play worker fixtures — exact engine replay validated

## Original A5 validation

Space Invaders source fixture copied byte-for-byte from commit1bfb1c4bc19cab9c5fc3ebae5a2a3717b8ac4fe8, frontend/src/games/space-invaders/lib/testdata/freeplay_vectors.json.4 terminal inputs +14 rejected inputs.

FPS source fixture copied byte-for-byte from60027e0714c0a64e8c23b91bc5b0a9d006199b2c, frontend/src/games/barricade/fps/freeplay/fixtures/terminal-vectors.json.2 terminal inputs. Its normalized Go-envelope fixture adds a fixed target/player and independently computes runID/payloadHash using Python hashlib SHA256 with uint32BE UTF8 lengths. Existing C stateHash/replayHash are preserved and independently checked against canonicalState/replay; no engine has been reimplemented or simulated by Python.

The composed dependency base is0d75ddbb1cca5855a677b6b3bc761054d6b01ae9
(A2 foundation5fb77eed plus the exact B/C commits above). Engines/codecs are
imported directly; none is copied or ported into Go. The source fixture's old
proposed-status metadata is retained to preserve its byte-for-byte provenance.

The real Node bundle was exercised through VerifyFreePlayRunWithWorker in Go:
all6 terminal fixtures match score/runID/stateHash/replayHash/payloadHash. All14
SI invalid vectors and9 FPS negative cases are rejected. Mock-exec tests remain
separate and prove only the envelope/process boundary. HTTP status classification,
legacy verification, shared capacity, cancellation/reaping, caps and cleanup were
also checked under-race. The first run had a platform-specific test assertion
failure (os.ErrProcessDone rather than ESRCH); the corrected test passed alone.
No other selected test failed or skipped; no data race was reported.

Both bundle builds are deterministic across repository/frontend working dirs.
The legacy verify-worker.cjs is byte-identical to the composed base. At that A5 stage, the dedicated
freeplay-worker.cjs was embedded without a main constructor and the HTTP feature
was disabled. That validation did not enable production.


## Final Arcade source composition, 2026-10-09

Rebuilt once from clean source commit
48c9792cbfa40ff7cc1d546b2c8f922800ca9289, composing reviewed Arcade lots and
Notes S4 d3ee6bab on main7a4f5c1a. Node v22.22.2, Go1.24.2 darwin/arm64 and
esbuild0.28.1, matching the frontend lock. A fresh npm ci attempt failed because
the registry DNS was unavailable. A private copy of the existing installation
was then checked against the same package/lock:735 installed package versions
matched and no required package was missing. This is distinct from a fresh CI install.

The relative-import closure contains19 actual TypeScript files, including the
Space Invaders engine index and its transitive imports. Only FPS codec.ts differs
from the original A5/A7 worker source: verifyFpsTranscript accepts an optional
terminal requirement, and verifyFpsTerminal always passes true. The generated
worker retains that strict terminal call. No rule, simulation version, fixture
commitment or gameplay engine changed.

Bundle SHA-256 after reconstruction:

- Legacy verify-worker.cjs: c9579ebae696af4a5e513dda86ef7275a2d29894e4b02ed4b36a73c2d2d8decb, byte-identical to the reviewed A5 bundle.
- Free play freeplay-worker.cjs: b3e9f762b5d4ede714e3414f7ee4778b35dcc27921bc78ae867936b2d701d731.

Real Node execution through the Go runner with -race -count=1 -p1 -parallel1
passed2 top-level tests and29 subtests:6 terminal golden fixtures and23 rejection
cases. Zero failure, skip or race diagnostic. This targeted run took40.54seconds
including compilation. Other previously validated suites were not automatically
repeated. Historical fixture origins above remain unchanged.

The integration evidence packet contains35 before/after file hashes, source and
generated diffs, command/environment metadata and complete JSON/stderr logs. An
early manifest collection stopped on an unexpanded directory; the pre-build
manifest was reconstructed from the exact Git blobs after a clean-HEAD check,
and the corrected19-file closure supersedes the earlier13-entry inventory.
Only the Free play bundle changed during reconstruction.

A7 now constructs a dormant runtime with nil configuration: no Free play worker,
publisher or signer starts. Backend migrations042/043 remain automatic on DB
startup and require the separate rollout authorization. These local proofs do
not authorize migration, deployment, activation or a mainnet transaction. Final
base/CI and browser acceptance remain separate.

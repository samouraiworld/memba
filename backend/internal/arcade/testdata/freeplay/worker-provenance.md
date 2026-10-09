# Free play worker fixtures — exact engine replay validated

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
The legacy verify-worker.cjs is byte-identical to the composed base. The dedicated
freeplay-worker.cjs is embedded but no constructor is called by main and the
HTTP feature remains disabled. This validation does not enable production.

# Free play v1 canonical vectors

`vectors.json` is shared input for the Go backend, TypeScript clients and realm
contract tests. LP encodes each UTF-8 string as a four-byte big-endian byte length
followed by its bytes. SHA256 is lowercase hex. Numeric fields use canonical
unsigned decimal strings, not raw JSON spellings.

The two terminal Block Party transcripts were generated from the existing
TypeScript engine at Memba `2d1ffc10071afa315680031315a4e3c4960a0857`, seed 4242,
standard modifier. A deterministic L/U/R/D cycle records only accepted moves;
the second fixture undoes its second accepted move before continuing. The
JavaScript Node crypto implementation computed the commitments independently of
the Go implementation. Scores are 3204 and 2832 respectively. These are free
runs longer than the old daily budget, not daily attestations.

`lp` contains UTF-8 and ambiguous-concatenation examples with both encoded bytes
and SHA256. Each `runs` entry includes input, expected runID, replayHash,
stateHash, payloadHash, score and the complete final TS engine state.

A runID binds the deployment, authenticated player, game and stable local UUID.
It deliberately does not change when a client mutates that run's replay: the
server/realm must report an immutable-run conflict. PayloadHash binds the full
verified result. ReplayHash may legitimately repeat across different players;
there is no global replay-hash ownership restriction in v2.

These vectors do not authorize any live signing or enable a game adapter.

// Regenerates the frozen TS↔Go differential corpus (500 deterministic games)
// consumed by the Go engine's corpus_test.go.
//
// This lives as a vitest test (so it can import the TS engine, which vitest
// resolves — plain `node --strip-types` cannot resolve the engine's
// extensionless imports). It is GATED behind GEN_CORPUS=1 so it is SKIPPED in
// the normal suite / CI and only writes the file when explicitly regenerated:
//
//   make blockparty-corpus
//     -> cd frontend && GEN_CORPUS=1 node ./node_modules/.bin/vitest run src/game/engine/corpus.gen.test.ts
//
// The output is deterministic; re-running it reproduces the committed corpus
// byte-for-byte (a clean `git diff`).
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { initGame, step, replay, rngNext } from "./index";
import type { Modifier, Move } from "./types";

it.runIf(process.env.GEN_CORPUS === "1")("regenerate diff_corpus.json", () => {
  const MODS: Modifier[] = ["standard", "doubles", "rush"];
  const DIRS: Move[] = ["U", "R", "D", "L"];
  const N = 500;
  let picker = 987654321 >>> 0; // deterministic picker, separate from game RNG
  const draw = () => {
    const r = rngNext(picker);
    picker = r.state;
    return r.value;
  };

  const corpus = [];
  for (let i = 0; i < N; i++) {
    const seed = draw();
    const modifier = MODS[draw() % MODS.length];
    const moves: Move[] = [];
    let s = initGame(seed, modifier);
    const len = 20 + (draw() % 200); // 20..219 moves
    for (let m = 0; m < len && !s.over; m++) {
      const mv = DIRS[draw() % 4];
      moves.push(mv);
      s = step(s, mv);
    }
    const r = replay(seed, modifier, moves);
    corpus.push({
      seed,
      modifier,
      moves,
      expectedBoard: r.board,
      expectedScore: r.score,
      expectedRngCallCount: r.rngCallCount,
      expectedOver: r.over,
    });
  }
  // CWD is frontend/ when run via the Makefile target.
  writeFileSync(
    "../backend/internal/blockparty/engine/testdata/diff_corpus.json",
    JSON.stringify(corpus) + "\n"
  );
});

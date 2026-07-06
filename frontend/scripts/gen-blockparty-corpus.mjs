// frontend/scripts/gen-blockparty-corpus.mjs
// Generates a deterministic corpus of random-but-legal games from the TS engine.
// Run: node frontend/scripts/gen-blockparty-corpus.mjs
import { writeFileSync } from "node:fs";
import { initGame, step, replay, rngNext } from "../src/game/engine/index.ts";

const MODS = ["standard", "doubles", "rush"];
const DIRS = ["U", "R", "D", "L"];
const N = 500;
let picker = 987654321 >>> 0; // deterministic move/seed picker, separate from game RNG
const draw = () => { const r = rngNext(picker); picker = r.state; return r.value; };

const corpus = [];
for (let i = 0; i < N; i++) {
  const seed = draw();
  const modifier = MODS[draw() % MODS.length];
  const moves = [];
  let s = initGame(seed, modifier);
  const len = 20 + (draw() % 200); // 20..219 moves
  for (let m = 0; m < len && !s.over; m++) {
    const mv = DIRS[draw() % 4];
    moves.push(mv);
    s = step(s, mv);
  }
  const r = replay(seed, modifier, moves);
  corpus.push({
    seed, modifier, moves,
    expectedBoard: r.board, expectedScore: r.score,
    expectedRngCallCount: r.rngCallCount, expectedOver: r.over,
  });
}
writeFileSync("../backend/internal/blockparty/engine/testdata/diff_corpus.json", JSON.stringify(corpus) + "\n");
console.log("wrote", corpus.length, "corpus games");

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { CORPUS_SCENARIOS } from "./corpus.scenarios";
import { simulateReplay } from "../lib/verify";

// The golden vectors: each scenario's seed + input log with its expected final
// tick, score, and state hash. Committed to disk so a Go/Gno engine port can
// load the SAME file and must reproduce the same score+hash — and so any
// accidental change to scoring/determinism fails CI here (regen deliberately
// with REGEN_CORPUS=1). Mirrors the Block Party corpus pattern.
// vitest runs from the frontend/ project root.
const FILE = join(process.cwd(), "src/games/space-invaders/engine/testdata/game_vectors.json");

interface Vector {
  name: string;
  seed: number;
  finalTick: number;
  score: number;
  hash: number;
}

function compute(): Vector[] {
  return CORPUS_SCENARIOS.map((sc) => {
    const r = simulateReplay(sc.log);
    return { name: sc.name, seed: sc.log.seed, finalTick: sc.log.finalTick, score: r.score, hash: r.hash };
  });
}

describe("determinism corpus (cross-language pin)", () => {
  it("reproduces the committed golden vectors", () => {
    const computed = compute();
    if (!existsSync(FILE) || process.env.REGEN_CORPUS) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(computed, null, 2) + "\n");
    }
    const golden = JSON.parse(readFileSync(FILE, "utf-8")) as Vector[];
    expect(computed).toEqual(golden);
  });

  it("every scenario is byte-for-byte reproducible (same log → same result)", () => {
    for (const sc of CORPUS_SCENARIOS) {
      expect(simulateReplay(sc.log)).toEqual(simulateReplay(sc.log));
    }
  });
});

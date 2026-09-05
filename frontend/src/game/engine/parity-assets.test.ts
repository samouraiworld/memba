import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backendFixture = (name: string) =>
  resolve(process.cwd(), `../backend/internal/blockparty/engine/testdata/${name}`);
const frontendFixture = (name: string) => resolve(process.cwd(), `src/game/engine/vectors/${name}`);

describe("TypeScript/Go compatibility assets", () => {
  it.each(["game_vectors.json", "prng_vectors.json"])("keeps %s byte-identical", (name) => {
    expect(readFileSync(frontendFixture(name))).toEqual(readFileSync(backendFixture(name)));
  });
});

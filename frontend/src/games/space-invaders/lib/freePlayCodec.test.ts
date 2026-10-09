import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import vectors from "./testdata/freeplay_vectors.json";
import { decodeFreeReplay, decodeFreeSeed, encodeFreeReplay, encodeFreeSeed, freePlayInputFromResult, SI_FREE_CODEC, SI_FREE_RULES, verifyFreePlayInput, type SpaceInvadersFreePlayInput } from "./freePlayCodec";
import { MAX_CERTIFY_EVENTS, MAX_CERTIFY_FINAL_TICK } from "./wire";

function hash(...fields: string[]) {
  return createHash("sha256").update(Buffer.concat(fields.flatMap(field => { const bytes = Buffer.from(field, "utf8"); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); return [length, bytes]; }))).digest("hex");
}
describe("Space Invaders Free codec fixtures for A", () => {
  it.each(vectors.valid)("reproduces terminal state and all commitments: $name", fixture => {
    const input = fixture.input as SpaceInvadersFreePlayInput;
    expect(decodeFreeSeed(input.seed)).toBe(fixture.engineSeed);
    expect(encodeFreeSeed(fixture.engineSeed)).toBe(input.seed);
    expect(decodeFreeReplay(input.replay)).toEqual({ finalTick: fixture.finalTick, events: fixture.events });
    expect(encodeFreeReplay(fixture.finalTick, fixture.events)).toBe(input.replay);
    expect(verifyFreePlayInput(input)).toEqual({ score: fixture.score, stateHash: fixture.stateHash, finalTick: fixture.finalTick });
    expect(freePlayInputFromResult(input.clientRunId, { game: "space-invaders", mode: "free", seed: fixture.engineSeed, simVersion: 1, finalTick: fixture.finalTick, events: fixture.events, score: fixture.score, hash: fixture.stateHash, verified: true })).toEqual(input);
    const id = hash("memba:free-run:v1", fixture.target.chainId, fixture.target.realm, fixture.player, input.game, input.clientRunId);
    const replay = hash("memba:free-replay:v1", input.game, input.rules, String(input.simVersion), input.seed, input.replayCodec, input.replay);
    expect(id).toBe(fixture.runID); expect(replay).toBe(fixture.replayHash);
    expect(hash("memba:free-anchor:v1", fixture.target.chainId, fixture.target.realm, id, fixture.player, input.game, input.rules, "1", input.seed, String(fixture.score), fixture.stateHash, replay)).toBe(fixture.payloadHash);
  });
  it.each(vectors.invalid)("rejects $name before accepting a snapshot", fixture => {
    expect(() => verifyFreePlayInput(fixture.input as SpaceInvadersFreePlayInput)).toThrow(fixture.expectedError);
  });
  it("bounds work before simulation and rejects alternate encodings", () => {
    expect(() => decodeFreeReplay(`${MAX_CERTIFY_FINAL_TICK + 1};0|0|1|0`)).toThrow("certification_limit");
    expect(() => encodeFreeReplay(20000, Array.from({ length: MAX_CERTIFY_EVENTS + 1 }, (_, tick) => [tick, 0, tick % 2, 0]))).toThrow("certification_limit");
    for (const text of ["10;0|0|1|0;", "10;0|0|1|0\n", "10;0|0|1|0;1|0|1|0", "10;1|0|1|0", "10;0|0|0|0", "10;0|0|1|0;10|0|0|0"]) expect(() => decodeFreeReplay(text)).toThrow("invalid_replay");
    expect(() => encodeFreeReplay(10, [[0, -0, 1, 0]])).toThrow("invalid_replay");
    expect(() => encodeFreeSeed(2 ** 32)).toThrow("invalid_replay");
    expect(() => encodeFreeSeed(-0)).toThrow("invalid_replay");
  });
  it("does not turn Daily or unverified results into a Free snapshot", () => {
    const f = vectors.valid[0];
    const outcome = { game: "space-invaders" as const, mode: "free" as const, seed: f.engineSeed, simVersion: 1, finalTick: f.finalTick, events: f.events, score: f.score, hash: f.stateHash, verified: false };
    expect(() => freePlayInputFromResult(f.input.clientRunId, outcome)).toThrow("replay_not_verified");
    expect(() => freePlayInputFromResult(f.input.clientRunId, { ...outcome, mode: "daily" })).toThrow("unsupported_rules");
    expect(SI_FREE_RULES).toBe("si-free-standard-v1"); expect(SI_FREE_CODEC).toBe("si-deltas-v1");
  });
});

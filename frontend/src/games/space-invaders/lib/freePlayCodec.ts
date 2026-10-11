import { REPLAY_VERSION } from "./replay";
import { fromWireDeltas, MAX_CERTIFY_EVENTS, MAX_CERTIFY_FINAL_TICK } from "./wire";
import { simulateReplay } from "./verify";
import type { SpaceInvadersReplayResult } from "./launch";

export const SI_FREE_RULES = "si-free-standard-v1" as const;
export const SI_FREE_CODEC = "si-deltas-v1" as const;
export const SI_FREE_VERSION = REPLAY_VERSION;
export const SI_FREE_MAX_BYTES = 1_000_000;
export const SI_FREE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Game-owned domain input, structurally accepted by A's FreePlayInput. */
export interface SpaceInvadersFreePlayInput {
  clientRunId: string;
  game: "space-invaders";
  rules: typeof SI_FREE_RULES;
  simVersion: number;
  seed: string;
  replayCodec: typeof SI_FREE_CODEC;
  replay: string;
  finishReason: "game-over";
  claimedScore: number;
}
export class SpaceInvadersFreePlayError extends Error {
  constructor(public readonly code: "invalid_replay" | "not_terminal" | "unsupported_version" | "unsupported_rules" | "claimed_result_mismatch" | "certification_limit" | "replay_not_verified" | "invalid_run_identity") { super(code); }
}
const fail = (code: ConstructorParameters<typeof SpaceInvadersFreePlayError>[0]): never => { throw new SpaceInvadersFreePlayError(code); };
const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= min && n <= max;

/** The numeric Free seed is encoded directly, never hashed as a Daily string. */
export function encodeFreeSeed(seed: number): string {
  if (!integer(seed, 0, 0xffffffff)) return fail("invalid_replay");
  return `si1:${seed.toString(16).padStart(8, "0")}`;
}
export function decodeFreeSeed(seed: string): number {
  if (seed.length !== 12 || !/^si1:[0-9a-f]{8}$/.test(seed)) return fail("invalid_replay");
  return Number.parseInt(seed.slice(4), 16);
}

function validateDeltas(finalTick: number, events: readonly (readonly number[])[]) {
  if (!integer(finalTick, 1, MAX_CERTIFY_FINAL_TICK) || events.length > MAX_CERTIFY_EVENTS) return fail("certification_limit");
  if (!events.length) return fail("invalid_replay");
  let lastTick = -1;
  let previous: readonly number[] | undefined;
  for (const event of events) {
    if (event.length !== 4 || !integer(event[0], 0, finalTick - 1) || event[0] <= lastTick || !integer(event[1], -10, 10) || !integer(event[2], 0, 1) || event[3] !== 0 || Object.is(event[3], -0)) return fail("invalid_replay");
    if (!previous && (event[0] !== 0 || event[2] !== 1)) return fail("invalid_replay");
    if (previous && previous[1] === event[1] && previous[2] === event[2]) return fail("invalid_replay");
    lastTick = event[0]; previous = event;
  }
}
export function encodeFreeReplay(finalTick: number, events: readonly (readonly number[])[]): string {
  validateDeltas(finalTick, events);
  const encoded = [String(finalTick), ...events.map(event => event.join("|"))].join(";");
  if (encoded.length > SI_FREE_MAX_BYTES) return fail("certification_limit");
  return encoded;
}
export function decodeFreeReplay(replay: string): { finalTick: number; events: number[][] } {
  if (replay.length > SI_FREE_MAX_BYTES) return fail("certification_limit");
  const fields = replay.split(";");
  if (fields.length < 2 || !/^[1-9][0-9]*$/.test(fields[0])) return fail("invalid_replay");
  if (fields.length - 1 > MAX_CERTIFY_EVENTS) return fail("certification_limit");
  const events = fields.slice(1).map(field => {
    if (!/^(0|[1-9][0-9]*)\|(-[1-9][0-9]*|0|[1-9][0-9]*)\|[01]\|0$/.test(field)) return fail("invalid_replay");
    return field.split("|").map(Number);
  });
  const finalTick = Number(fields[0]);
  validateDeltas(finalTick, events);
  if (encodeFreeReplay(finalTick, events) !== replay) return fail("invalid_replay");
  return { finalTick, events };
}

/** Independent TS oracle for fixtures/verifier adapters, not a network client. */
export function verifyFreeReplay(seed: string, replay: string) {
  const decoded = decodeFreeReplay(replay);
  const result = simulateReplay({ version: SI_FREE_VERSION, seed: decodeFreeSeed(seed), finalTick: decoded.finalTick, inputs: fromWireDeltas(decoded.events) });
  if (result.state.phase !== "gameover" || result.firstGameoverTick !== decoded.finalTick) return fail("not_terminal");
  return { score: result.score, stateHash: result.hash.toString(16).padStart(8, "0"), finalTick: decoded.finalTick };
}

/** Snapshot the already locally verified terminal outcome. A verifies it again. */
export function freePlayInputFromResult(clientRunId: string, result: SpaceInvadersReplayResult): SpaceInvadersFreePlayInput {
  if (clientRunId.length !== 36 || !SI_FREE_UUID.test(clientRunId)) return fail("invalid_run_identity");
  if (result.mode !== "free" || result.game !== "space-invaders") return fail("unsupported_rules");
  if (result.simVersion !== SI_FREE_VERSION) return fail("unsupported_version");
  const seed = encodeFreeSeed(result.seed);
  const replay = encodeFreeReplay(result.finalTick, result.events);
  if (!result.verified) return fail("replay_not_verified");
  if (!integer(result.score, 0, Number.MAX_SAFE_INTEGER) || result.hash.length !== 8 || !/^[0-9a-f]{8}$/.test(result.hash)) return fail("invalid_replay");
  return Object.freeze({ clientRunId, game: "space-invaders", rules: SI_FREE_RULES, simVersion: SI_FREE_VERSION, seed, replayCodec: SI_FREE_CODEC, replay, finishReason: "game-over", claimedScore: result.score });
}

/** Adapter oracle: scope/version are checked before any simulation work. */
export function verifyFreePlayInput(input: SpaceInvadersFreePlayInput) {
  if (input.game !== "space-invaders" || input.rules !== SI_FREE_RULES || input.replayCodec !== SI_FREE_CODEC) return fail("unsupported_rules");
  if (input.simVersion !== SI_FREE_VERSION) return fail("unsupported_version");
  if (input.finishReason !== "game-over") return fail("not_terminal");
  if (input.clientRunId.length !== 36 || !SI_FREE_UUID.test(input.clientRunId)) return fail("invalid_run_identity");
  const result = verifyFreeReplay(input.seed, input.replay);
  if (input.claimedScore !== result.score) return fail("claimed_result_mismatch");
  return result;
}

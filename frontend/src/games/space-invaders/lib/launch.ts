import type { RunMode } from "../screens/types";

/** Local adapter boundary. The OS owns delivery and window presentation. */
export interface SpaceInvadersLaunchIntent {
  id: string;
  game: "space-invaders";
  mode: RunMode;
}

/** A locally checked replay, not a publication receipt or a server assertion. */
export interface SpaceInvadersReplayResult {
  game: "space-invaders";
  mode: RunMode;
  seed: number;
  simVersion: number;
  finalTick: number;
  events: number[][];
  score: number;
  hash: string;
  verified: boolean;
}

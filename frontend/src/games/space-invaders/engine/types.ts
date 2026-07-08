export type Phase = "ready" | "playing" | "paused" | "gameover";

export interface Rect { x: number; y: number; w: number; h: number }

export interface Alien extends Rect {
  alive: boolean;
  row: number; // 0 = top row (worth most)
  col: number;
}

export interface Bullet extends Rect {
  alive: boolean;
}

export interface InputIntent {
  move: -1 | 0 | 1;
  fire: boolean;
  pause: boolean;
}

export interface GameState {
  phase: Phase;
  rng: number;
  player: Rect;
  lives: number;
  invulnMs: number;
  score: number;
  wave: number;
  aliens: Alien[];
  dir: 1 | -1;
  stepAccumMs: number;
  playerBullet: Bullet | null;
  alienBullets: Bullet[];
  alienFireMs: number;
}

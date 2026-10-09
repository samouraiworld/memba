/** C1 preview rules. Independent of Classic v2; never submit these logs to its verifier. */
export const FPS_RULESET = 'barricade-fps-c1' as const
export const FPS_VERSION = 3 as const
export const HZ = 60
export const MAX_TICKS = 180 * HZ
export const MAX_EVENTS = 20_000
export const MAX_ENEMIES = 16
export const MAGAZINE = 12
export const FIRE_INTERVAL = 9
export const RELOAD_TICKS = 90
export const REPAIR_TICKS = 12 * HZ
export const WAVE_COUNTS = [6, 9, 12] as const
export const SPAWN_INTERVAL = 180
export const EYE: Vec3 = { x: 0, y: 1650, z: 1800 }
export const AXIS_START = [-14_000, 0, 14_000] as const
export const AXIS_END = [-1800, 0, 1800] as const
export const SPAWN_Z = -28_000
export const CONTACT_Z = -1600
export type Vec3 = { x: number; y: number; z: number }
export type Axis = 0 | 1 | 2
export type Enemy = { id: number; axis: Axis; kind: 'crs' | 'robot'; progress: number; speed: number; hp: number }
export type Phase = 'wave' | 'repair' | 'won' | 'lost'
export type State = {
    tick: number; seed: string; rng: number; phase: Phase; wave: number; waveStarted: number
    spawned: number; nextId: number; enemies: Enemy[]; hp: number; ammo: number
    reloadUntil: number; fireAt: number; repairUntil: number; patchAvailable: boolean
    score: number; kills: number; shots: number
}
export type Input = { type: 'fire'; direction: Vec3 } | { type: 'reload' | 'repair' | 'continue' }
export type Event = Input & { tick: number }
export type Impact = { tick: number; point: Vec3; kind: 'miss' | 'shield' | 'body' | 'weak'; killed: boolean }
export type Replay = { ruleset: typeof FPS_RULESET; version: typeof FPS_VERSION; seed: string; events: Event[]; finalTick: number }
export function terminal(s: State): boolean { return s.phase === 'won' || s.phase === 'lost' }

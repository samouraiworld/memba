import { encodeFreeSeed, SI_FREE_RULES, SI_FREE_UUID, SI_FREE_VERSION } from "./freePlayCodec";

const ACTIVE_KEY = "memba:space-invaders:active-free:v1";
export interface FreePlayRunIdentity { clientRunId: string; seed: number }
export interface IdentityStorage { setItem(key: string, value: string): void }

/** Exactly once per new Free run, never at render, auth, resize or retry. */
export function createFreePlayIdentity(seed: number, crypto: Pick<Crypto, "getRandomValues">): FreePlayRunIdentity {
  encodeFreeSeed(seed);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return Object.freeze({ seed, clientRunId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` });
}
/** Only the active identity is game-owned; completed snapshots belong to A. */
export function persistFreePlayIdentity(storage: IdentityStorage, identity: FreePlayRunIdentity): void {
  if (identity.clientRunId.length !== 36 || !SI_FREE_UUID.test(identity.clientRunId)) throw new Error("invalid_run_identity");
  storage.setItem(ACTIVE_KEY, JSON.stringify({ schemaVersion: 1, game: "space-invaders", clientRunId: identity.clientRunId, seed: encodeFreeSeed(identity.seed), rules: SI_FREE_RULES, simVersion: SI_FREE_VERSION }));
}

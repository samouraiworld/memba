// Wave intro timing and the one-time wave-1 how-to. Presentation only: the flag lives in localStorage
// and never touches the simulation or the replay log.

/** How long the "WAVE N" banner stays over the stage when a wave starts. */
export const WAVE_BANNER_MS = 1400;

const HOWTO_KEY = "memba.space-invaders.howto-seen";

/** How long the how-to stays up before a move or fire may dismiss it, so a
 *  player who launched the run by holding a key still gets to read it. */
export const HOWTO_MIN_MS = 1800;

export function loadHowtoSeen(): boolean {
  try {
    return localStorage.getItem(HOWTO_KEY) === "1";
  } catch {
    return true; // storage blocked: never nag on every run
  }
}

export function saveHowtoSeen(): void {
  try {
    localStorage.setItem(HOWTO_KEY, "1");
  } catch {
    /* storage unavailable — best effort */
  }
}

export type RunMode = "free" | "daily";

/** The part of a finished daily run the result screen shows. */
export interface DailyVerification {
  day: string; // YYYY-MM-DD (UTC)
  verified: boolean;
}

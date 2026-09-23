import type { RunMode } from "./types";

/** The armed-but-idle overlay: the run starts on the first move or fire. */
export function ReadyScreen({
  mode,
  dailyDay,
  onChangeTransmission,
}: {
  mode: RunMode;
  dailyDay: string;
  onChangeTransmission: () => void;
}) {
  return (
    <div className="si-overlay si-ready">
      <p className="si-overlay-kicker">{mode === "daily" ? `Daily signal · ${dailyDay}` : "Free signal"}</p>
      <h2>Relay standing by</h2>
      <p className="si-control-line">← → move · Space fire · Enter launch</p>
      <p className="si-overlay-copy">Move, fire or press Enter to begin. On touch, drag left to steer and tap right to fire.</p>
      <button className="si-text-button" type="button" onClick={onChangeTransmission}>Change transmission</button>
    </div>
  );
}

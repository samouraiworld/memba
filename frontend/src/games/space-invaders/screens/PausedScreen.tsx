/** The pause sheet. The simulation consumes no ticks while it is shown. */
export function PausedScreen({ onResume }: { onResume: () => void }) {
  return (
    <div className="si-overlay si-pause-sheet">
      <p className="si-overlay-kicker">Signal held</p>
      <h2>Relay paused</h2>
      <p className="si-overlay-copy">The simulation is frozen. Resume when you are ready.</p>
      <p className="si-overlay-copy si-pause-controls">← → / A D (Q D on AZERTY) move · Space / W / Z fire · P / Esc pause. Touch: drag left to steer, tap right to fire.</p>
      <button className="si-button si-button--primary" type="button" onClick={onResume}>Resume defense</button>
    </div>
  );
}

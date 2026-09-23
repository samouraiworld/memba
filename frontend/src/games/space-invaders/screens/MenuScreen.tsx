/** The mode chooser shown before a run is armed (ready phase, not armed). */
export function MenuScreen({
  certifyOn,
  onDaily,
  onFree,
}: {
  certifyOn: boolean;
  onDaily: () => void;
  onFree: () => void;
}) {
  return (
    <div className="si-overlay si-menu">
      <p className="si-overlay-kicker">Choose transmission</p>
      <h2>Defend the Gno relay</h2>
      <p className="si-overlay-copy">One shared signal. One score to beat. The daily run is replay-checked on this device when it ends.</p>
      <div className="si-mode-stack">
        <button className="si-button si-button--primary si-mode-button" type="button" onClick={onDaily}>
          <span>Daily run</span>
          <small>{certifyOn ? "Shared UTC signal · replay eligible" : "Shared UTC signal · same waves for everyone"}</small>
        </button>
        <button className="si-button si-button--secondary si-mode-button" type="button" onClick={onFree}>
          <span>Free play</span>
          <small>Fresh signal · practice without certification</small>
        </button>
      </div>
    </div>
  );
}

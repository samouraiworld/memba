/** Three-step first-visit intro. Shown once; the first move also dismisses it. */
export function FirstRunIntro({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="k-bp-intro" aria-labelledby="k-bp-intro-title">
      <div className="k-bp-intro-head">
        <h2 id="k-bp-intro-title">How to play</h2>
        <button type="button" className="k-bp-intro-dismiss" onClick={onDismiss}>
          Got it
        </button>
      </div>
      <ol className="k-bp-intro-steps">
        <li>
          <span className="k-bp-intro-num" aria-hidden="true">1</span>
          <span><strong>Slide</strong> every tile with a swipe or the arrow keys.</span>
        </li>
        <li>
          <span className="k-bp-intro-num" aria-hidden="true">2</span>
          <span><strong>Merge</strong> two equal numbers to add them to your score.</span>
        </li>
        <li>
          <span className="k-bp-intro-num" aria-hidden="true">3</span>
          <span><strong>Daily</strong> is one ranked run per day. <strong>Practice</strong> is unlimited.</span>
        </li>
      </ol>
    </section>
  );
}

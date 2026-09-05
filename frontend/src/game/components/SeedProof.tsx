import "./panels.css";

const VERIFY_DOC_URL =
  "https://github.com/samouraiworld/memba/blob/main/scripts/VERIFY_BLOCKPARTY.md";

// The headline claim is "provably un-rigged from a chain block" — this line is
// the in-app proof affordance: which block seeded today's board, and how
// anyone can re-derive it (scripts/verify-blockparty-seed.mjs, documented in
// the linked doc). Height/hash come from GetDailyChallenge, which the page
// already fetches.
export function SeedProof({ sourceLabel, height, hash }: { sourceLabel?: string; height: number; hash: string }) {
  if (!height || !hash) return null;
  return (
    <details className="k-bp-seedproof">
      <summary>
        <span className="k-bp-seedproof-mark" aria-hidden="true">⌁</span>
        <span>
          <strong>Daily seed</strong>
          <span>{sourceLabel ?? "Configured seed source"} · block #{height.toLocaleString("en-US")}</span>
        </span>
      </summary>
      <div className="k-bp-seedproof-detail">
        <span>Block fingerprint</span>
        <code>{hash.slice(0, 10)}…</code>
        <a href={VERIFY_DOC_URL} target="_blank" rel="noopener noreferrer">
          Verify this board<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </details>
  );
}

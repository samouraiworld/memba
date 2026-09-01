const VERIFY_DOC_URL =
  "https://github.com/samouraiworld/memba/blob/main/scripts/VERIFY_BLOCKPARTY.md";

// The headline claim is "provably un-rigged from a chain block" — this line is
// the in-app proof affordance: which block seeded today's board, and how
// anyone can re-derive it (scripts/verify-blockparty-seed.mjs, documented in
// the linked doc). Height/hash come from GetDailyChallenge, which the page
// already fetches.
export function SeedProof({ chainId, height, hash }: { chainId: string; height: number; hash: string }) {
  if (!height || !hash) return null;
  return (
    <p className="k-bp-seedproof">
      Seeded by {chainId} block #{height.toLocaleString("en-US")} · <code>{hash.slice(0, 10)}…</code> ·{" "}
      <a href={VERIFY_DOC_URL} target="_blank" rel="noopener noreferrer">
        Verify
      </a>
    </p>
  );
}

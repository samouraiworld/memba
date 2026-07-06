export function PeekQueue({ next }: { next: number | null }) {
  if (next == null) return null;
  return <div className="k-bp-peek"><span className="k-bp-eyebrow">NEXT</span><span>{next}</span></div>;
}

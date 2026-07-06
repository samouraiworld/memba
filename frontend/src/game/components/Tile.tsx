import { milestoneLabel } from "../lib/tiers";
export function Tile({ value }: { value: number }) {
  if (value === 0) return <div className="k-bp-cell k-bp-cell--empty" aria-hidden />;
  const label = milestoneLabel(value);
  // brightness ramp by exponent for colorblind-safe differentiation
  const exp = Math.log2(value);
  return (
    <div className="k-bp-cell k-bp-tile" data-exp={exp} role="gridcell" aria-label={`${value}`}>
      <span className="k-bp-tile-val">{value}</span>
      {label && <span className="k-bp-tile-label">{label}</span>}
    </div>
  );
}

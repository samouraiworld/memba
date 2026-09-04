import { milestoneLabel } from "../lib/tiers";
export function Tile({ value, index = 0 }: { value: number; index?: number }) {
  const label = milestoneLabel(value);
  const row = Math.floor(index / 4) + 1;
  const col = (index % 4) + 1;
  const exp = value > 0 ? Math.log2(value) : 0;
  const tier = value >= 512 ? "beacon" : value >= 32 ? "relay" : "signal";
  const accessibleLabel = value === 0
    ? `Row ${row}, column ${col}, empty`
    : `Row ${row}, column ${col}, ${value}${label ? `, ${label} milestone` : ""}`;

  if (value === 0) {
    return (
      <div
        className="k-bp-cell k-bp-cell--empty"
        role="gridcell"
        aria-rowindex={row}
        aria-colindex={col}
        aria-label={accessibleLabel}
      >
        <span className="k-bp-cell-port" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className="k-bp-cell k-bp-tile"
      data-exp={exp}
      data-tier={tier}
      role="gridcell"
      aria-rowindex={row}
      aria-colindex={col}
      aria-label={accessibleLabel}
    >
      <span className="k-bp-tile-orbit" aria-hidden="true" />
      <span className="k-bp-tile-val">{value}</span>
      {label && <span className="k-bp-tile-label">{label}</span>}
    </div>
  );
}

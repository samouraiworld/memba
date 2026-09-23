import type { CSSProperties } from "react";
import { milestoneLabel } from "../lib/tiers";
import type { MotionTile } from "../lib/tileMotion";

/**
 * One grid slot. It carries the accessible cell semantics (role, position,
 * value) for screen readers and tests; the visible tiles live in a separate,
 * aria-hidden layer so they can slide between slots without remounting.
 */
export function Cell({ value, index }: { value: number; index: number }) {
  const label = milestoneLabel(value);
  const row = Math.floor(index / 4) + 1;
  const col = (index % 4) + 1;
  const accessibleLabel = value === 0
    ? `Row ${row}, column ${col}, empty`
    : `Row ${row}, column ${col}, ${value}${label ? `, ${label} milestone` : ""}`;

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

/** Values past 2048 share the top visual tier; each value below has its own colour. */
function tier(value: number): "tint" | "solid" | "super" {
  if (value > 2048) return "super";
  return value >= 512 ? "solid" : "tint";
}

export function Tile({ tile }: { tile: MotionTile }) {
  const { value, index, kind } = tile;
  const label = milestoneLabel(value);
  const position = { "--bp-row": Math.floor(index / 4), "--bp-col": index % 4 } as CSSProperties;

  return (
    <div className="k-bp-tile-pos" data-kind={kind} style={position}>
      <div className="k-bp-cell k-bp-tile" data-exp={Math.log2(value)} data-tier={tier(value)} data-kind={kind}>
        <span className="k-bp-tile-orbit" />
        <span className="k-bp-tile-val">{value}</span>
        {label && <span className="k-bp-tile-label">{label}</span>}
      </div>
    </div>
  );
}

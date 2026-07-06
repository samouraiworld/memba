const LABELS: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };
export function ModifierBadge({ modifier }: { modifier: string }) {
  return <span className="k-bp-modifier">{LABELS[modifier] ?? modifier}</span>;
}

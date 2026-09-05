import "./board.css";

const LABELS: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };
const DESCRIPTIONS: Record<string, string> = {
  standard: "Standard daily rules",
  doubles: "Doubles Day modifier",
  rush: "Rush modifier with a shorter move budget",
};

export function ModifierBadge({ modifier }: { modifier: string }) {
  const label = LABELS[modifier] ?? modifier;
  return <span className="k-bp-modifier" aria-label={DESCRIPTIONS[modifier] ?? `${label} modifier`}>{label}</span>;
}

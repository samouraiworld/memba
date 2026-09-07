import { describe, it, expect } from "vitest";
import { formatRiskAssessment } from "./format.js";

function riskRow(text: string): string {
  const md = formatRiskAssessment(
    {
      riskLevel: "low",
      risks: [{ category: text, severity: "low", description: "d", mitigation: "m" }],
      overallAssessment: "ok",
    },
    "1",
    "/r/demo/dao",
    "test-model"
  );
  const row = md.split("\n").find((l) => l.startsWith("| ") && l.endsWith(" | low | d | m |"));
  if (!row) throw new Error(`risk row not found in:\n${md}`);
  return row;
}

describe("formatRiskAssessment table cells", () => {
  it("escapes pipes so a cell cannot break the table", () => {
    expect(riskRow("a|b")).toBe("| a\\|b | low | d | m |");
  });

  it("flattens newlines to spaces", () => {
    expect(riskRow("a\nb")).toBe("| a b | low | d | m |");
  });

  it("escapes backslashes before pipes so an existing backslash cannot neutralise the pipe escape", () => {
    // sanitizeCell("x\\|y") === "x\\\\\\|y": the backslash is doubled, then the pipe is escaped.
    expect(riskRow("x\\|y")).toBe("| x\\\\\\|y | low | d | m |");
  });
});

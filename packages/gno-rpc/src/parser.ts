/**
 * Parser for Gno vm/qeval responses.
 *
 * qeval returns Go-typed string literals like:
 *   ("42" int)
 *   ("true" bool)
 *   ("hello world" string)
 *   (nil)
 *
 * This parser extracts the value and type.
 */

export interface QevalResult {
  raw: string;
  value: string | null;
  type: string | null;
}

/**
 * Parse a qeval response string into a typed result.
 *
 * Examples:
 *   '("42" int)'       → { value: "42", type: "int" }
 *   '("true" bool)'    → { value: "true", type: "bool" }
 *   '("" string)'      → { value: "", type: "string" }
 *   '(nil)'            → { value: null, type: null }
 *   'multi\nline'      → { value: "multi\nline", type: null } (unparsed)
 */
export function parseQevalResponse(raw: string): QevalResult {
  const trimmed = raw.trim();

  // Handle nil
  if (trimmed === "(nil)") {
    return { raw: trimmed, value: null, type: null };
  }

  // Match Go-typed result: ("value" type) — handles escaped quotes in value
  const match = trimmed.match(/^\("((?:[^"\\]|\\.)*)"\s+(\w+)\)$/);
  if (match) {
    return {
      raw: trimmed,
      value: match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      type: match[2],
    };
  }

  // Multi-value or complex response — return raw
  return { raw: trimmed, value: trimmed, type: null };
}

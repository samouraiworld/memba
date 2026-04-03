import { describe, it, expect } from "vitest";
import { parseQevalResponse } from "./parser.js";

describe("parseQevalResponse", () => {
  it("parses integer result", () => {
    const result = parseQevalResponse('("42" int)');
    expect(result.value).toBe("42");
    expect(result.type).toBe("int");
  });

  it("parses boolean result", () => {
    const result = parseQevalResponse('("true" bool)');
    expect(result.value).toBe("true");
    expect(result.type).toBe("bool");
  });

  it("parses string result", () => {
    const result = parseQevalResponse('("hello world" string)');
    expect(result.value).toBe("hello world");
    expect(result.type).toBe("string");
  });

  it("parses empty string result", () => {
    const result = parseQevalResponse('("" string)');
    expect(result.value).toBe("");
    expect(result.type).toBe("string");
  });

  it("parses nil", () => {
    const result = parseQevalResponse("(nil)");
    expect(result.value).toBeNull();
    expect(result.type).toBeNull();
  });

  it("handles escaped quotes in value", () => {
    const result = parseQevalResponse('("say \\"hello\\"" string)');
    expect(result.value).toBe('say "hello"');
    expect(result.type).toBe("string");
  });

  it("returns raw for unparseable input", () => {
    const result = parseQevalResponse("multi\nline\noutput");
    expect(result.value).toBe("multi\nline\noutput");
    expect(result.type).toBeNull();
  });

  it("trims whitespace", () => {
    const result = parseQevalResponse('  ("5" int)  ');
    expect(result.value).toBe("5");
    expect(result.type).toBe("int");
  });

  it("preserves raw in all cases", () => {
    const result = parseQevalResponse('("42" int)');
    expect(result.raw).toBe('("42" int)');
  });
});

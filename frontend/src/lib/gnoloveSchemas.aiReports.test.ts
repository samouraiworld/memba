/**
 * Zod additive migration for prompt v2 fields.
 *
 * Locks in that AIReportProjectSchema:
 *   - still parses v1-shaped rows (legacy field-set only),
 *   - parses v2 rows with summary_short / summary_long / team,
 *   - silently drops unrelated additions from the data envelope
 *     (.passthrough lets unknown keys through but they don't show
 *     up on the parsed shape, which is what we want).
 */

import { describe, it, expect } from "vitest"
import { AIReportProjectSchema, AIReportSchema } from "./gnoloveSchemas"

describe("AIReportProjectSchema — prompt v1 (legacy)", () => {
    it("parses {project_name, summary} alone", () => {
        const parsed = AIReportProjectSchema.parse({
            project_name: "gnolang/gno",
            summary: "The Gno protocol core hummed with fresh glyphs this cycle.",
        })
        expect(parsed.summary).toContain("Gno protocol")
        expect(parsed.summary_short).toBeUndefined()
        expect(parsed.summary_long).toBeUndefined()
        expect(parsed.team).toBeUndefined()
    })

    it("rejects rows missing project_name or summary", () => {
        expect(() => AIReportProjectSchema.parse({ project_name: "x" })).toThrow()
        expect(() => AIReportProjectSchema.parse({ summary: "x" })).toThrow()
    })
})

describe("AIReportProjectSchema — prompt v2", () => {
    it("parses the new optional fields", () => {
        const parsed = AIReportProjectSchema.parse({
            project_name: "gnolang/gno",
            summary: "Long form for legacy readers.",
            summary_short: "VM bumped.",
            summary_long: "Alice bumped the VM — worth a leadership eye.",
            team: "core-team",
        })
        expect(parsed.summary_short).toBe("VM bumped.")
        expect(parsed.summary_long).toBe("Alice bumped the VM — worth a leadership eye.")
        expect(parsed.team).toBe("core-team")
    })

    it("allows empty strings on the new fields without throwing", () => {
        // The plan's R-8 mitigation lives at the consumer layer (use ||).
        // The schema's job is just to accept the wire shape.
        const parsed = AIReportProjectSchema.parse({
            project_name: "x/y",
            summary: "legacy fallback",
            summary_short: "",
            summary_long: "",
        })
        expect(parsed.summary_short).toBe("")
        expect(parsed.summary_long).toBe("")
    })
})

describe("AIReportSchema envelope", () => {
    it("parses a v1-shaped report end-to-end", () => {
        const parsed = AIReportSchema.parse({
            id: "report-1",
            createdAt: "2026-05-04T00:00:00Z",
            data: {
                projects: [
                    { project_name: "gnolang/gno", summary: "summary v1" },
                ],
            },
        })
        expect(parsed.promptVersion).toBeUndefined()
        expect(parsed.data.projects[0].summary).toBe("summary v1")
    })

    it("parses a v2-shaped report with promptVersion at the top level", () => {
        const parsed = AIReportSchema.parse({
            id: "report-2",
            createdAt: "2026-05-11T00:00:00Z",
            promptVersion: 2,
            data: {
                cycle: "Weekly Report — May 11, 2026",
                projects: [
                    {
                        project_name: "gnolang/gno",
                        summary: "long form",
                        summary_short: "short",
                        summary_long: "long form",
                        team: "core-team",
                    },
                ],
            },
        })
        expect(parsed.promptVersion).toBe(2)
        expect(parsed.data.cycle).toContain("May 11")
        expect(parsed.data.projects[0].team).toBe("core-team")
    })

    it("ignores unknown top-level data fields without dropping the parse", () => {
        // .passthrough() on AIReportDataSchema means future fields
        // (e.g. an `errors` list, a `metrics` object) don't break v2 readers.
        const parsed = AIReportSchema.parse({
            id: "report-3",
            createdAt: "2026-05-18T00:00:00Z",
            data: {
                projects: [{ project_name: "x/y", summary: "z" }],
                unknownFutureField: { whatever: 42 },
            },
        })
        expect(parsed.data.projects).toHaveLength(1)
    })
})

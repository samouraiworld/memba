import { describe, expect, it } from "vitest"
import { aiReportDate, reportToMarkdown } from "./gnoloveAiExport"

describe("AI report Markdown export", () => {
    it("preserves AI content as text without turning it into links, images, headings, or HTML", () => {
        const markdown = reportToMarkdown({
            id: "week-1",
            createdAt: "2026-09-27T12:00:00Z",
            data: {
                projects: [{
                    project_name: "Gno\n# injected heading <img src=x>",
                    summary: "short",
                    summary_long: "![tracking](https://tracker.invalid/pixel)\n[click](javascript:alert(1))\n<script>bad</script>",
                }],
            },
        })
        expect(markdown).toContain("## Gno\n\\# injected heading &lt;img src\\=x&gt;")
        expect(markdown).toContain("\\!\\[tracking\\]\\(https://tracker\\.invalid/pixel\\)")
        expect(markdown).toContain("\\[click\\]\\(javascript:alert\\(1\\)\\)")
        expect(markdown).toContain("&lt;script&gt;bad&lt;/script&gt;")
        expect(markdown).not.toContain("![tracking]")
        expect(markdown).not.toContain("<script>")
    })

    it("uses a safe date in output names and footer", () => {
        expect(aiReportDate("2026-09-27T12:00:00Z")).toBe("2026-09-27")
        expect(aiReportDate("not-a-date\n![x](https://tracker.invalid)")).toBe("unknown-date")
    })
})

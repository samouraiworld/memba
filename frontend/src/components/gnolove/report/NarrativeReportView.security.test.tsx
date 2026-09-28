import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DEFAULT_REPORT_STATE } from "../../../lib/gnoloveReportUrl"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import { NarrativeReportView } from "./NarrativeReportView"

afterEach(() => vi.restoreAllMocks())

it("keeps untrusted PR content literal in copied narrative Markdown and visible links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const pr = {
        id: "1",
        number: 1,
        title: "![pixel](https://evil.test/x)\n# injected heading",
        url: "javascript:alert(1)",
        authorLogin: "[attacker](https://evil.test)",
        state: "MERGED",
        createdAt: "2026-09-14T12:00:00Z",
        updatedAt: "2026-09-15T12:00:00Z",
        mergedAt: "2026-09-15T12:00:00Z",
    } as TPullRequest

    render(<NarrativeReportView
        report={{ merged: [pr], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }}
        activeTab="all"
        period="all_time"
        start={new Date("2026-09-14T00:00:00Z")}
        end={new Date("2026-09-20T23:59:59Z")}
        selectedTeam="all"
        selectedRepos={new Set()}
        urlState={DEFAULT_REPORT_STATE}
        networkKey="test12"
        emptyReason="filter"
        onClearTeam={() => {}}
        onClearRepos={() => {}}
        onClearTab={() => {}}
        onClearAll={() => {}}
    />)

    expect(screen.queryByRole("link", { name: "#1" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const markdown = writeText.mock.calls[0][0] as string
    expect(markdown).toContain("\\!\\[pixel\\]")
    expect(markdown).toContain("\\# injected heading")
    expect(markdown).toContain("@\\[attacker\\]")
    expect(markdown).not.toContain("![pixel]")
    expect(markdown).not.toContain("javascript:")
})

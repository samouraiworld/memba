/**
 * ThreadView.test.tsx — author edit/delete controls.
 *
 * The channel realm's EditThread/DeleteThread are author-only. These tests cover
 * the UI gating (author + v2-realm support) and that the inline editor / delete
 * invoke the callbacks BoardView wires to the on-chain builders.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ThreadView } from "./ThreadView"
import type { BoardThreadDetail } from "./parser"

const AUTHOR = "g1author0000000000000000000000000000000"

function makeThread(overrides: Partial<BoardThreadDetail> = {}): BoardThreadDetail {
    return {
        id: 1,
        channel: "general",
        title: "Hello",
        body: "original body",
        author: AUTHOR,
        blockHeight: 100,
        edited: false,
        editedAt: 0,
        replies: [],
        ...overrides,
    } as BoardThreadDetail
}

const base = {
    hasNewContent: false,
    onDismissNew: () => {},
    isAuthenticated: true,
    replyBody: "",
    onReplyChange: () => {},
    onSubmitReply: () => {},
    posting: false,
    error: null,
}

describe("ThreadView — author edit/delete controls", () => {
    it("hides Edit/Delete when the caller is not the author", () => {
        render(
            <ThreadView
                {...base}
                threadDetail={makeThread()}
                callerAddress="g1someoneelse000000000000000000000000000"
                supportsModeration
                onEditThread={vi.fn()}
                onDeleteThread={vi.fn()}
            />,
        )
        expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument()
    })

    it("hides Edit/Delete when the realm does not support moderation (legacy board)", () => {
        render(
            <ThreadView
                {...base}
                threadDetail={makeThread()}
                callerAddress={AUTHOR}
                supportsModeration={false}
                onEditThread={vi.fn()}
                onDeleteThread={vi.fn()}
            />,
        )
        expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument()
    })

    it("hides Edit/Delete on an already-deleted thread", () => {
        render(
            <ThreadView
                {...base}
                threadDetail={makeThread({ title: "[Deleted]" })}
                callerAddress={AUTHOR}
                supportsModeration
                onEditThread={vi.fn()}
                onDeleteThread={vi.fn()}
            />,
        )
        expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
    })

    it("shows controls for the author and invokes onDeleteThread", () => {
        const onDelete = vi.fn()
        render(
            <ThreadView
                {...base}
                threadDetail={makeThread()}
                callerAddress={AUTHOR}
                supportsModeration
                onEditThread={vi.fn()}
                onDeleteThread={onDelete}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: "Delete" }))
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it("edits the body via the inline editor and calls onEditThread with the new text", () => {
        const onEdit = vi.fn()
        render(
            <ThreadView
                {...base}
                threadDetail={makeThread()}
                callerAddress={AUTHOR}
                supportsModeration
                onEditThread={onEdit}
                onDeleteThread={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        const textarea = screen.getByDisplayValue("original body")
        fireEvent.change(textarea, { target: { value: "updated body" } })
        fireEvent.click(screen.getByRole("button", { name: "Save" }))
        expect(onEdit).toHaveBeenCalledWith("updated body")
    })
})

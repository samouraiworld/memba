export const NOTES_MARKDOWN_LIMITS = { inputBytes: 131_072, outputBytes: 524_288, depth: 64, tags: 12_000 } as const
export type NotesRenderFailure = "input-limit" | "output-limit" | "depth-limit" | "tag-limit" | "parse-failed" | "timeout" | "unavailable" | "cancelled"
export interface NotesRenderRequest { id: number; markdown: string }
export type NotesRenderReply = { id: number; status: "parsed"; html: string } | { id: number; status: "failed"; reason: NotesRenderFailure }
export type NotesRenderResult = { kind: "html"; html: string } | { kind: "text"; text: string; reason: NotesRenderFailure; truncated: boolean }

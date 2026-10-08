import { parseNotesMarkdown } from "./renderWorker"
import type { NotesRenderRequest, NotesRenderReply } from "./renderProtocol"

const worker = self as unknown as { onmessage: ((event: MessageEvent<NotesRenderRequest>) => void) | null; postMessage(reply: NotesRenderReply): void }
worker.onmessage = event => worker.postMessage(parseNotesMarkdown(event.data))

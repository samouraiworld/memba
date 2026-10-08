import { ByteReader, concat, NotesCryptoError, text, utf8 } from './bytes'
import { MAX_COMMENT_BYTES } from './padding'

export interface CommentPayload { body: string; quote: string; prefix: string; suffix: string }
const FIELDS = ['body', 'quote', 'prefix', 'suffix'] as const
const LIMITS = [1000, 280, 32, 32] as const
function validate(value: string, max: number): string {
  const bytes = utf8(value)
  if ([...value].length > max || bytes.length > max * 4 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== value) throw new NotesCryptoError('format')
  return value
}
/** One encrypted payload prevents swapping an anchor and body encrypted under the same key. */
export function encodeComment(payload: CommentPayload): Uint8Array {
  return concat(...FIELDS.map((field, i) => text(validate(payload[field], LIMITS[i]))))
}
export function decodeComment(bytes: Uint8Array): CommentPayload {
  if (bytes.length > MAX_COMMENT_BYTES) throw new NotesCryptoError('format')
  const reader = new ByteReader(bytes), output = {} as CommentPayload
  try {
    for (let i = 0; i < FIELDS.length; i++) {
      const length = reader.u32()
      if (length > LIMITS[i] * 4) throw new NotesCryptoError('format')
      output[FIELDS[i]] = validate(new TextDecoder('utf-8', { fatal: true }).decode(reader.take(length)), LIMITS[i])
    }
    reader.done(); return output
  } catch { throw new NotesCryptoError('format') }
}

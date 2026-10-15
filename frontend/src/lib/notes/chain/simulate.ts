import type { AminoMsg } from '../../grc20'
import { check, NotesChainError } from './schema'

// `.app/simulate` of one unsigned vm/MsgCall (tm2 amino binary = proto3 wire: std.Tx, vm.m_call, sdk.Result).
// The node runs it on its committed state without a signature (the caller's stored public key is used), so the
// exact storage deposit and gas come back. Nothing is signed or broadcast.
const utf8 = new TextEncoder()
function varint(value: bigint): number[] {
  const out: number[] = []
  for (; value > 127n; value >>= 7n) out.push(Number(value & 127n) | 128)
  out.push(Number(value)); return out
}
function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}
const bytesField = (n: number, value: Uint8Array) => concat([varint(BigInt(n << 3 | 2)), varint(BigInt(value.length)), value])
const stringField = (n: number, value: string) => bytesField(n, utf8.encode(value))
/** std.Tx{msgs: [Any(/vm.m_call)], fee: {sint64 gas_wanted, gas_fee}, signatures: [{}]}: one empty signature, as tx.ValidateBasic counts one per signer. */
export function unsignedCallTx(message: AminoMsg, gasWanted: number, feeUgnot: number): Uint8Array {
  check(message.type === 'vm/MsgCall' && Number.isSafeInteger(gasWanted) && gasWanted > 0 && Number.isSafeInteger(feeUgnot) && feeUgnot > 0)
  const v = message.value as { caller: string; send: string; max_deposit: string; pkg_path: string; func: string; args: string[] }
  const call = concat([stringField(1, v.caller), ...(v.send ? [stringField(2, v.send)] : []), ...(v.max_deposit ? [stringField(3, v.max_deposit)] : []),
    stringField(4, v.pkg_path), stringField(5, v.func), ...v.args.map(arg => stringField(6, arg))])
  const fee = concat([varint(8n), varint(BigInt(gasWanted) * 2n), stringField(2, `${feeUgnot}ugnot`)])
  return concat([bytesField(1, concat([stringField(1, '/vm.m_call'), bytesField(2, call)])), bytesField(2, fee), bytesField(3, new Uint8Array())])
}
type Field = { n: number; varint?: bigint; bytes?: Uint8Array }
function fields(buffer: Uint8Array): Field[] {
  const out: Field[] = []; let at = 0
  const read = () => {
    let value = 0n, shift = 0n
    for (;;) { check(at < buffer.length && shift < 70n); const byte = buffer[at++]; value |= BigInt(byte & 127) << shift; shift += 7n; if (!(byte & 128)) return value }
  }
  while (at < buffer.length) {
    const key = Number(read()), n = key >> 3, wire = key & 7
    if (wire === 0) out.push({ n, varint: read() })
    else { check(wire === 2); const length = Number(read()); check(at + length <= buffer.length); out.push({ n, bytes: buffer.subarray(at, at + length) }); at += length }
  }
  return out
}
const unzigzag = (value: bigint) => (value & 1n) ? -((value + 1n) >> 1n) : value >> 1n
const text = (value: Uint8Array | undefined) => new TextDecoder('utf-8', { fatal: true }).decode(value ?? new Uint8Array())
/**
 * The deposit (`/tm.StorageDepositEvent`, bytes × price, summed over every realm) and gas the node measured. A node that
 * refuses the call because `max_deposit` is too small says how much it requires: that is read too (`aboveCap`), so the
 * caller can refuse rather than sign a transaction the node predicts will fail. Any other error, a storage unlock or
 * unreadable bytes is refused (`unavailable`): the caller falls back to its bound.
 */
export function readSimulation(result: Uint8Array, storagePriceUgnot: bigint): { gasUsed: number; depositUgnot: bigint; aboveCap: boolean } {
  try {
    let gasUsed = -1n, deposit = 0n, base: Field[] = []
    for (const field of fields(result)) {
      if (field.n === 1 && field.bytes) base = fields(field.bytes)
      if (field.n === 3 && field.varint !== undefined) gasUsed = unzigzag(field.varint)
    }
    check(gasUsed > 0n && gasUsed <= BigInt(Number.MAX_SAFE_INTEGER))
    const error = base.find(field => field.n === 1)
    if (error) {
      const log = new TextDecoder().decode(base.find(field => field.n === 4)?.bytes ?? new Uint8Array())
      const short = /not enough deposit to cover the storage usage: requires ([0-9]{1,18})ugnot for ([0-9]{1,15}) bytes/.exec(log)
      check(short && BigInt(short[1]) === BigInt(short[2]) * storagePriceUgnot)
      return { gasUsed: Number(gasUsed), depositUgnot: BigInt(short![1]), aboveCap: true }
    }
    for (const event of base.filter(field => field.n === 3 && field.bytes)) {
      const any = fields(event.bytes!), type = text(any.find(field => field.n === 1)?.bytes)
      check(type !== '/tm.StorageUnlockEvent')
      if (type !== '/tm.StorageDepositEvent') continue
      const body = fields(any.find(field => field.n === 2)?.bytes ?? new Uint8Array())
      const bytes = unzigzag(body.find(field => field.n === 1)?.varint ?? 0n), amount = bytes * storagePriceUgnot
      check(bytes > 0n && text(body.find(field => field.n === 2)?.bytes) === `${amount}ugnot`)
      deposit += amount
    }
    return { gasUsed: Number(gasUsed), depositUgnot: deposit, aboveCap: false }
  } catch { throw new NotesChainError('unavailable') }
}

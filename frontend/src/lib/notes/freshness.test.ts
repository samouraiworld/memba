import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceNoteChange, announceNotesFocus, NotesTimeoutError, readFresh, useNoteFreshness, useNoteRefresh, withTimeout } from './freshness'

const id = 'ab'.repeat(16)
afterEach(() => { vi.useRealTimers() })

describe('note freshness signals', () => {
    it('delivers confirmed changes only for the same network and note', () => {
        const seen = vi.fn()
        const view = renderHook(() => useNoteFreshness('onyx-1', id, seen))
        announceNoteChange({ chainId: 'onyx-1', noteId: 'cd'.repeat(16), stateRevision: '2' })
        announceNoteChange({ chainId: 'gnoland-1', noteId: id, stateRevision: '2' })
        expect(seen).not.toHaveBeenCalled()
        announceNoteChange({ chainId: 'onyx-1', noteId: id, stateRevision: '5' })
        expect(seen).toHaveBeenCalledWith({ stateRevision: '5' })
        view.unmount(); announceNoteChange({ chainId: 'onyx-1', noteId: id }); expect(seen).toHaveBeenCalledOnce()
    })
    it('re-checks when the window or the note window regains focus, at most every few seconds after its own read', () => {
        vi.useFakeTimers(); vi.setSystemTime(10_000)
        const seen = vi.fn()
        renderHook(() => useNoteFreshness('onyx-1', id, seen))
        act(() => { window.dispatchEvent(new Event('focus')) }); expect(seen).not.toHaveBeenCalled()
        vi.setSystemTime(15_000); act(() => { window.dispatchEvent(new Event('focus')) }); expect(seen).toHaveBeenCalledTimes(1)
        act(() => { announceNotesFocus('onyx-1', id) }); expect(seen).toHaveBeenCalledTimes(1)
        act(() => { announceNotesFocus('onyx-1', 'cd'.repeat(16)) }); vi.setSystemTime(20_000); act(() => { announceNotesFocus('gnoland-1') }); expect(seen).toHaveBeenCalledTimes(1)
        act(() => { announceNotesFocus('onyx-1', id) }); expect(seen).toHaveBeenCalledTimes(2)
        expect(seen).toHaveBeenLastCalledWith({})
    })
    it('always delivers a confirmed change, whatever the focus throttle', () => {
        const seen = vi.fn()
        renderHook(() => useNoteFreshness('onyx-1', id, seen))
        act(() => { window.dispatchEvent(new Event('focus')) }); expect(seen).not.toHaveBeenCalled()
        announceNoteChange({ chainId: 'onyx-1', noteId: id, stateRevision: '3' })
        expect(seen).toHaveBeenCalledExactlyOnceWith({ stateRevision: '3' })
    })
})

describe('bounded steps', () => {
    it('rejects a step that does not settle in time and passes results through', async () => {
        vi.useFakeTimers()
        const late = withTimeout(new Promise(() => {}), 1000)
        vi.advanceTimersByTime(1000)
        await expect(late).rejects.toBeInstanceOf(NotesTimeoutError)
        await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
        await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
    })
})

describe('lag-tolerant reads', () => {
    it('re-reads until the announced revision is visible, a bounded number of times', async () => {
        const read = vi.fn().mockResolvedValueOnce({ rev: '4' }).mockResolvedValueOnce(null).mockResolvedValue({ rev: '5' })
        expect(await readFresh(read, value => value?.rev ?? null, '5', () => true, 4, 1)).toEqual({ rev: '5' })
        expect(read).toHaveBeenCalledTimes(3)
        const stuck = vi.fn(async () => ({ rev: '4' }))
        expect(await readFresh(stuck, value => value.rev, '5', () => true, 2, 1)).toEqual({ rev: '4' }); expect(stuck).toHaveBeenCalledTimes(3)
        const once = vi.fn(async () => ({ rev: '1' }))
        await readFresh(once, value => value.rev, undefined, () => true, 4, 1); expect(once).toHaveBeenCalledOnce()
    })
    it('stops when its reader is gone', async () => {
        let alive = true
        const read = vi.fn(async () => { alive = false; return { rev: '1' } })
        expect(await readFresh(read, value => value.rev, '5', () => alive, 4, 1)).toBeUndefined(); expect(read).toHaveBeenCalledOnce()
    })
    it('counts refresh requests and remembers the highest announced revision', () => {
        const view = renderHook(() => useNoteRefresh('onyx-1', id))
        expect(view.result.current.tick).toBe(0); expect(view.result.current.minimum()).toBeUndefined()
        act(() => announceNoteChange({ chainId: 'onyx-1', noteId: id, stateRevision: '7' }))
        act(() => announceNoteChange({ chainId: 'onyx-1', noteId: id, stateRevision: '6' }))
        expect(view.result.current.tick).toBe(2); expect(view.result.current.minimum()).toBe('7')
        act(() => view.result.current.bump()); expect(view.result.current.tick).toBe(3)
    })
})

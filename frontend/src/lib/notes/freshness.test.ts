import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceNoteChange, announceNotesFocus, NotesTimeoutError, useNoteFreshness, withTimeout } from './freshness'

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mayCloseWindow, registerCloseGuard } from './closeGuards'

const releases: (() => void)[] = []
afterEach(() => { releases.splice(0).forEach(release => release()) })
describe('window close guards', () => {
    it('asks every part of a window that holds unsaved text, stopping at the first refusal', () => {
        const editor = vi.fn(() => true), comment = vi.fn(() => false)
        releases.push(registerCloseGuard('app:notes', editor), registerCloseGuard('app:notes', comment))
        expect(mayCloseWindow('app:notes')).toBe(false)
        expect(editor).toHaveBeenCalledOnce(); expect(comment).toHaveBeenCalledOnce()
        expect(mayCloseWindow('app:feed')).toBe(true)
    })
    it('lets the window close once its guards are released', () => {
        const release = registerCloseGuard('app:notes', () => false)
        release(); release()
        expect(mayCloseWindow('app:notes')).toBe(true)
    })
})

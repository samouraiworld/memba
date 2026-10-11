import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUnsavedText } from './notesPane'

function Holder({ unsaved }: { unsaved: boolean }) { useUnsavedText(unsaved, 'Leave without posting?'); return null }
function unload() {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(event)
    return event.defaultPrevented
}

describe('unsaved Notes text', () => {
    it('asks before a reload or a navigation away from the page while text is held, and only then', () => {
        const view = render(<Holder unsaved={false} />)
        expect(unload()).toBe(false)
        view.rerender(<Holder unsaved />)
        expect(unload()).toBe(true)
        view.rerender(<Holder unsaved={false} />)
        expect(unload()).toBe(false)
        view.rerender(<Holder unsaved />)
        view.unmount()
        expect(unload()).toBe(false)
    })
})

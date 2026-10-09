import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowActivityContext } from '../../../os/page/WindowActivity'
import FpsPreview from './FpsPreview'

vi.mock('../render/three/caps', () => ({ detectHas3D: () => true }))
vi.mock('../render/three/fps/FpsScene', () => ({ default: function MockScene({ onReady }: { onReady: () => void }) {
    useEffect(onReady, [onReady])
    return <div data-testid="fps-scene" />
} }))
vi.mock('../hooks/useGameLoop', () => ({ useGameLoop: vi.fn() }))

describe('FPS preview lifecycle and explicit capture', () => {
    const lock = vi.fn().mockResolvedValue(undefined)
    beforeEach(() => { HTMLElement.prototype.requestPointerLock = lock; document.exitPointerLock = vi.fn(); lock.mockClear() })
    afterEach(() => vi.restoreAllMocks())
    it('waits for a user gesture, and ordinary play never requests pointer lock or submits a score', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch')
        render(<FpsPreview onClassic={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        expect(lock).not.toHaveBeenCalled()
        expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Jouer · visée libre' }), { key: ' ' })).toBe(true)
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · visée libre' }))
        expect(lock).not.toHaveBeenCalled()
        expect(screen.queryByRole('heading', { name: 'Trois axes. Une barricade.' })).toBeNull()
        expect(fetch).not.toHaveBeenCalled()
    })
    it('requests capture only from its dedicated button and pauses on blur', async () => {
        render(<FpsPreview onClassic={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · capturer la souris' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · capturer la souris' }))
        expect(lock).toHaveBeenCalledTimes(1)
        fireEvent(window, new Event('blur'))
        expect(screen.getByRole('dialog', { name: 'Partie en pause' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Reprendre · visée libre' })).toHaveFocus()
    })
    it('keeps drag play usable when capture is rejected', async () => {
        lock.mockRejectedValueOnce(new Error('denied'))
        render(<FpsPreview onClassic={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · capturer la souris' })).toBeEnabled())
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Jouer · capturer la souris' })))
        expect(screen.getByRole('button', { name: 'Tirer' })).toBeEnabled()
        fireEvent.click(screen.getByRole('button', { name: 'Pause · P' }))
        expect(screen.getByText('Capture indisponible. Glissez sur la scène pour viser.')).toBeInTheDocument()
        expect(lock).toHaveBeenCalledTimes(1)
    })
    it('pauses with its OS window and never resumes automatically', async () => {
        const view = (active: boolean) => <WindowActivityContext.Provider value={active}><FpsPreview onClassic={vi.fn()} /></WindowActivityContext.Provider>
        const { rerender } = render(view(true))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · visée libre' }))
        rerender(view(false)); expect(screen.getByRole('dialog', { name: 'Partie en pause' })).toBeInTheDocument()
        rerender(view(true)); expect(screen.getByRole('dialog', { name: 'Partie en pause' })).toBeInTheDocument()
        expect(lock).not.toHaveBeenCalled()
    })
    it('returns to Classic explicitly without converting the run', async () => {
        const classic = vi.fn(); render(<FpsPreview onClassic={classic} />)
        await screen.findByTestId('fps-scene')
        fireEvent.click(screen.getByRole('button', { name: 'Retour à Classic' }))
        expect(classic).toHaveBeenCalledOnce()
    })
})

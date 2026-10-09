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
const loop = vi.hoisted(() => ({ step: (_steps: number) => { void _steps } }))
vi.mock('../hooks/useGameLoop', () => ({ useGameLoop: (_running: boolean, onSteps: (steps: number) => void) => { loop.step = onSteps } }))

describe('FPS preview lifecycle and explicit capture', () => {
    const lock = vi.fn().mockResolvedValue(undefined)
    beforeEach(() => { localStorage.clear(); HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.requestPointerLock = lock; document.exitPointerLock = vi.fn(); lock.mockClear() })
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
    it('does not steal another window’s focus when parked, and stays paused on reactivation', async () => {
        const view = (active: boolean) => <><button>Other OS window</button><WindowActivityContext.Provider value={active}><FpsPreview onClassic={vi.fn()} /></WindowActivityContext.Provider></>
        const { rerender } = render(view(true))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · visée libre' }))
        screen.getByRole('button', { name: 'Other OS window' }).focus()
        rerender(view(false))
        expect(screen.getByRole('button', { name: 'Other OS window' })).toHaveFocus()
        expect(screen.getByRole('dialog', { name: 'Partie en pause' })).toBeInTheDocument()
        rerender(view(true))
        expect(screen.getByRole('dialog', { name: 'Partie en pause' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Tirer' })).toBeDisabled()
    })
    it('keeps the firing finger held when the aiming finger is lifted', async () => {
        const { container } = render(<FpsPreview onClassic={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · visée libre' }))
        const pointer = (target: Element, type: string, id: number) => fireEvent(target, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: id, pointerType: 'touch', clientX: 100, clientY: 100, button: 0 }))
        pointer(screen.getByRole('button', { name: 'Tirer' }), 'pointerdown', 1)
        const aim = container.querySelector('.fps-input')!
        pointer(aim, 'pointerdown', 2)
        pointer(aim, 'pointerup', 2)
        pointer(aim, 'lostpointercapture', 2)
        act(() => loop.step(10))
        expect(screen.getByLabelText('État de la partie')).toHaveTextContent('10/12')
        pointer(screen.getByRole('button', { name: 'Tirer' }), 'pointerup', 1)
        act(() => loop.step(30))
        expect(screen.getByLabelText('État de la partie')).toHaveTextContent('10/12')
    })
    it('mounts the injected shared result only after a real terminal run and preserves export', async () => {
        const handle = { render: () => <p>Shared result panel</p>, dispose: vi.fn() }
        const prepare = vi.fn().mockResolvedValue(handle)
        const { unmount } = render(<FpsPreview onClassic={vi.fn()} freePlay={{ prepare }} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        expect(prepare).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Jouer · visée libre' }))
        act(() => loop.step(10800))
        expect(await screen.findByText('Shared result panel')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Exporter le replay' })).toBeEnabled()
        expect(prepare).toHaveBeenCalledOnce()
        unmount(); expect(handle.dispose).toHaveBeenCalledOnce()
    })
    it('opens an older A result by ID without starting or replacing the current game, and disposes on close', async () => {
        const oldId = '55555555-5555-4555-8555-555555555555'
        const handle = { render: () => <p>Saved receipt fixture</p>, dispose: vi.fn() }
        const saved = { list: vi.fn(() => ({ runs: [{ clientRunId: oldId, score: 123 }], unavailable: 1 })), open: vi.fn(() => handle) }
        const prepare = vi.fn()
        const { container, unmount } = render(<FpsPreview onClassic={vi.fn()} freePlay={{ prepare, saved }} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled())
        const activeId = localStorage.getItem('memba:barricade:fps:active:v1')
        expect(saved.list).not.toHaveBeenCalled(); expect(saved.open).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Résultats sauvegardés' }))
        expect(saved.list).toHaveBeenCalledOnce()
        expect(screen.getByText('1 sauvegarde(s) récente(s) indisponible(s).')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Identifiant du résultat'), { target: { value: oldId } })
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir ce résultat' }))
        expect(saved.open).toHaveBeenCalledWith(oldId)
        expect(screen.getByText('Saved receipt fixture')).toBeInTheDocument()
        expect(container.querySelector('.fps-preview')).toHaveAttribute('data-status', 'ready')
        expect(localStorage.getItem('memba:barricade:fps:active:v1')).toBe(activeId)
        expect(prepare).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Fermer les sauvegardes' }))
        expect(handle.dispose).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole('button', { name: 'Résultats sauvegardés' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir ce résultat' }))
        unmount(); expect(handle.dispose).toHaveBeenCalledTimes(2)
    })
    it('keeps ID recovery available when A reports a corrupt index', async () => {
        const saved = { list: () => { throw new Error('invalid_snapshot_index') }, open: () => { throw new Error('missing_fps_result') } }
        render(<FpsPreview onClassic={vi.fn()} freePlay={{ prepare: vi.fn(), saved }} />)
        await screen.findByTestId('fps-scene')
        fireEvent.click(screen.getByRole('button', { name: 'Résultats sauvegardés' }))
        expect(screen.getByRole('alert')).toHaveTextContent('liste des sauvegardes est illisible')
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir ce résultat' }))
        expect(screen.getByRole('alert')).toHaveTextContent('Résultat introuvable sur cet appareil')
        expect(screen.getByRole('button', { name: 'Jouer · visée libre' })).toBeEnabled()
    })
    it('returns to Classic explicitly without converting the run', async () => {
        const classic = vi.fn(); render(<FpsPreview onClassic={classic} />)
        await screen.findByTestId('fps-scene')
        fireEvent.click(screen.getByRole('button', { name: 'Retour à Classic' }))
        expect(classic).toHaveBeenCalledOnce()
    })
})

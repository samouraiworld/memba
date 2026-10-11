import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
vi.mock('./render/three/caps', () => ({ resolveRenderer: () => '2d' }))
vi.mock('./fps/FpsPreview', () => ({ default: ({ onClassic }: { onClassic: () => void }) => <button onClick={onClassic}>FPS preview exit</button> }))
import Barricade from './Barricade'
function LocationProbe() { const location = useLocation(); return <output aria-label="Current URL">{location.pathname}{location.search}{location.hash}</output> }
describe('explicit game-local FPS entry', () => {
    it('loads only on the exact preview query and removes only that parameter on exit', async () => {
        render(<MemoryRouter initialEntries={['/mainnet/game/barricade?barricadePreview=fps&keep=1#review']}><Barricade /><LocationProbe /></MemoryRouter>)
        fireEvent.click(await screen.findByRole('button', { name: 'FPS preview exit' }))
        expect(screen.getByRole('button', { name: 'Daily run' })).toBeInTheDocument()
        expect(screen.getByLabelText('Current URL')).toHaveTextContent('/mainnet/game/barricade?keep=1#review')
    })
    it('keeps Classic and the URL when external recovery selects an FPS archive', async () => {
        const dispose = vi.fn(), onClose = vi.fn(), saved = { list: () => ({ runs: [], unavailable: 0 }), open: vi.fn(() => ({ render: () => <p>Saved archive</p>, dispose })) }
        render(<MemoryRouter initialEntries={['/mainnet/game/barricade?keep=1']}><Barricade fpsFreePlay={{ prepare: vi.fn(), saved }} recovery={{ clientRunId: '55555555-5555-4555-8555-555555555555', onClose }} /><LocationProbe /></MemoryRouter>)
        expect(await screen.findByText('Saved archive')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Daily run', hidden: true })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'FPS preview exit' })).toBeNull()
        expect(screen.getByLabelText('Current URL')).toHaveTextContent('/mainnet/game/barricade?keep=1')
        fireEvent.click(screen.getByRole('button', { name: 'Fermer le résultat sauvegardé' }))
        expect(onClose).toHaveBeenCalledOnce()
    })
    it('does not replace Classic for unrelated or malformed preview parameters', () => {
        render(<MemoryRouter initialEntries={['/mainnet/game/barricade?barricadePreview=other']}><Barricade /></MemoryRouter>)
        expect(screen.getByRole('button', { name: 'Daily run' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'FPS preview exit' })).toBeNull()
    })
})

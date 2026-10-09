import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { PublicEditButton } from './PublicEditButton'
const permission = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/notes/chain/publicPermissions', () => ({ readPublicWritePermission: permission }))
const note = { id: 'ab'.repeat(16), stateRevision: '2', owner: 'owner', mode: 3 } as ChainNote
const client = {} as NotesReadClient
beforeEach(() => vi.clearAllMocks())
describe('public writer edit entry', () => {
    it('waits for verified ACL and passes a detached note to the editor', async () => {
        let resolve!: (allowed: boolean) => void
        permission.mockReturnValue(new Promise<boolean>(done => { resolve = done }))
        const edit = vi.fn(); render(<PublicEditButton note={note} owner="writer" client={client} onEdit={edit} />)
        expect(screen.queryByRole('button')).toBeNull()
        resolve(true); fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
        expect(edit.mock.calls[0][0]).toEqual(note); expect(edit.mock.calls[0][0]).not.toBe(note)
    })
    it('ignores a late permission from the previous account', async () => {
        let resolve!: (allowed: boolean) => void
        permission.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done })).mockResolvedValue(false)
        const props = { note, client, onEdit: vi.fn() }
        const { rerender } = render(<PublicEditButton {...props} owner="writer" />)
        rerender(<PublicEditButton {...props} owner="reader" />); resolve(true)
        await waitFor(() => expect(permission).toHaveBeenCalledTimes(2))
        expect(screen.queryByRole('button')).toBeNull()
    })
})

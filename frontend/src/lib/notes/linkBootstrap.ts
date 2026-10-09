/** The bootstrap owns the only URL-key copy, outside persistent browser storage. */
export function clearNotesLink(): void {
    const clear = (window as Window & { __membaClearNotesLink?: () => void }).__membaClearNotesLink
    clear?.()
}

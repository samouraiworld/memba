import { useRef, useState, type KeyboardEvent } from "react"

const MAX_SHOTS = 6

/** Screenshot viewer: one large image, thumbnails, arrow keys, and a lightbox dialog. */
export function MediaGallery({ name, images: all }: { name: string; images: readonly string[] }) {
    const images = all.slice(0, MAX_SHOTS)
    const [index, setIndex] = useState(0)
    const [zoomed, setZoomed] = useState(false)
    const dialog = useRef<HTMLDialogElement>(null)
    if (images.length === 0) return null
    const current = Math.min(index, images.length - 1)
    const alt = (i: number) => `${name} screenshot ${i + 1}`
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "ArrowRight") setIndex((current + 1) % images.length)
        else if (event.key === "ArrowLeft") setIndex((current - 1 + images.length) % images.length)
    }
    const zoom = () => { setZoomed(true); dialog.current?.showModal?.() }
    const close = () => dialog.current?.close?.()
    return <section className="os-cin-gallery" aria-label={`${name} screenshots`} onKeyDown={onKey}>
        <button type="button" className="os-cin-view" onClick={zoom} aria-label={`Enlarge ${alt(current)}`}>
            <img src={images[current]} alt={alt(current)} />
            {images.length > 1 && <span className="os-cin-count" aria-hidden="true">{current + 1} / {images.length}</span>}
        </button>
        {images.length > 1 && <div className="os-cin-thumbs">
            {images.map((src, i) => <button key={`${i}`} type="button" className="os-cin-thumb" aria-label={`Show ${alt(i)}`} aria-current={i === current ? "true" : undefined} onClick={() => setIndex(i)}><img src={src} alt="" loading="lazy" /></button>)}
        </div>}
        <dialog ref={dialog} className="os-cin-lightbox" aria-label={alt(current)} onClose={() => setZoomed(false)} onClick={(event) => { if (event.target === event.currentTarget) close() }}>
            {zoomed && <img src={images[current]} alt="" />}
            <button type="button" className="os-cin-btn os-cin-lightbox-close" onClick={close}>Close</button>
        </dialog>
    </section>
}

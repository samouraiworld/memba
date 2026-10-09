import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, CylinderGeometry, DataTexture, DynamicDrawUsage, InstancedMesh, MeshStandardMaterial, Object3D, RepeatWrapping, RGBAFormat, SphereGeometry, SRGBColorSpace, type BufferGeometry } from 'three'
import { batchKey, type Finish, type Part, type Shape } from './art'

/** Tiny original deterministic surface noise; no downloaded textures or canvas dependency. */
export function surfacePixels(finish: Finish, edge = 64): Uint8Array {
    const data = new Uint8Array(edge * edge * 4)
    let seed = finish.split('').reduce((n, c) => n + c.charCodeAt(0), 1337)
    for (let i = 0; i < edge * edge; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const x = i % edge, y = Math.floor(i / edge)
        const grain = (seed >>> 24) / 255
        const v = Math.round(finish === 'wood' ? 200 + 35 * Math.sin(x * 1.8 + grain * .5) : finish === 'stone' && y % 16 === 0 ? 193 : 214 + grain * 41)
        data.set([v, v, v, 255], i * 4)
    }
    return data
}
export function groupParts(parts: readonly Part[]): Map<string, Part[]> {
    const groups = new Map<string, Part[]>()
    for (const p of parts) { const key = batchKey(p); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(p) }
    return groups
}
function resources(shape: Shape, finish: Finish) {
    const geometry: BufferGeometry = shape === 'sphere' ? new SphereGeometry(.5, 10, 6) : shape === 'cylinder' ? new CylinderGeometry(.5, .5, 1, 8) : new BoxGeometry(1, 1, 1)
    const textured = ['stone', 'wood', 'asphalt', 'cloth'].includes(finish)
    const texture = textured ? new DataTexture(surfacePixels(finish), 64, 64, RGBAFormat) : null
    if (texture) { texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping; texture.needsUpdate = true }
    const material = new MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: finish === 'stone' ? .02 : .008, roughness: finish === 'glass' ? .25 : finish === 'metal' ? .57 : .92, metalness: finish === 'metal' ? .4 : 0,
        ...(finish === 'light' ? { emissive: '#e6a456', emissiveIntensity: .65 } : {}) })
    return { geometry, material, texture }
}
/** One draw per geometry/finish, including all colors. Dynamic readers are renderer-only. */
function Batch({ shape, finish, parts, read, capacity }: { shape: Shape; finish: Finish; parts: readonly Part[]; read?: () => readonly Part[]; capacity: number }) {
    const ref = useRef<InstancedMesh>(null)
    const assets = useMemo(() => resources(shape, finish), [shape, finish])
    const scratch = useMemo(() => ({ object: new Object3D(), color: new Color() }), [])
    useEffect(() => () => { assets.geometry.dispose(); assets.material.dispose(); assets.texture?.dispose() }, [assets])
    const write = (items: readonly Part[]) => {
        const mesh = ref.current
        if (!mesh) return
        if (items.length > capacity) throw new Error('FPS art instance capacity exceeded')
        mesh.count = items.length
        for (let i = 0; i < items.length; i++) {
            const p = items[i], o = scratch.object
            o.position.set(...p.at); o.rotation.set(...(p.rotate ?? [0, 0, 0])); o.scale.set(...p.size); o.updateMatrix()
            mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, scratch.color.set(p.color))
        }
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    useEffect(() => { if (ref.current && read) ref.current.instanceMatrix.setUsage(DynamicDrawUsage); write(parts) })
    useFrame(() => { if (read) write(read()) })
    return <instancedMesh ref={ref} args={[assets.geometry, assets.material, capacity]} frustumCulled={false} dispose={null} />
}
export function StaticBatches({ parts }: { parts: readonly Part[] }) {
    const groups = useMemo(() => groupParts(parts), [parts])
    return <>{[...groups].map(([key, items]) => <Batch key={key} shape={items[0].shape} finish={items[0].finish} parts={items} capacity={items.length} />)}</>
}
export function DynamicBatch({ shape, finish, read, capacity }: { shape: Shape; finish: Finish; read: () => readonly Part[]; capacity: number }) {
    return <Batch shape={shape} finish={finish} parts={[]} read={read} capacity={capacity} />
}

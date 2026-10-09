import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type Mesh } from 'three'
import { position, shieldUp } from '../../../sim/fps/collision'
import { EYE, MAX_ENEMIES, RELOAD_TICKS } from '../../../sim/fps/types'
import type { Session } from '../../../fps/session'
import { actorKit, batchKey, streetKit, weaponKit, type Finish, type Part, type Shape } from './art'
import { DynamicBatch, StaticBatches } from './Batches'

type Props = { session: Session; running: boolean; reducedMotion: boolean; light: 'dusk' | 'day'; onReady: () => void; onFailure: () => void }
const street = streetKit()
const actorKeys = [...new Set([...actorKit('crs', 0, true), ...actorKit('crs', 0, false), ...actorKit('robot', 0, false)].map(batchKey))]
const effectsCapacity = 24

/** Stable presentation buffers. No geometry/material/part allocations in the frame loop. */
function makeActorBuffers() {
    const buckets = new Map(actorKeys.map(key => [key, [] as Part[]]))
    const rigs = Array.from({ length: MAX_ENEMIES }, () => ['closed', 'open', 'robot'].map((kind) => {
        const originals = actorKit(kind === 'robot' ? 'robot' : 'crs', 0, kind === 'closed')
        return originals.map(base => ({ base, key: batchKey(base), posed: { ...base, at: [...base.at], rotate: [0, 0, 0] } as Part }))
    }))
    return {
        read: (key: string) => buckets.get(key)!,
        update(state: ReturnType<Session['read']>['state'], previous: ReturnType<Session['read']>['previous'], alpha: number, reducedMotion: boolean) {
            for (const bucket of buckets.values()) bucket.length = 0
            for (let i = 0; i < state.enemies.length; i++) {
                const e = state.enemies[i], now = position(e), before = previous.enemies.find(p => p.id === e.id)
                const prior = before ? position(before) : now
                const x = (prior.x + (now.x - prior.x) * alpha) / 1000, z = (prior.z + (now.z - prior.z) * alpha) / 1000
                const rig = rigs[i][e.kind === 'robot' ? 2 : shieldUp(e, state.tick) ? 0 : 1]
                const walk = reducedMotion ? 0 : (state.tick + alpha + e.id * 17) * .13
                for (const { base, key, posed } of rig) {
                    const side = Math.sign(base.at[0]), swing = reducedMotion ? 0 : Math.sin(walk + (side < 0 ? Math.PI : 0))
                    const leg = Math.abs(base.at[0]) >= .16 && base.at[1] < .7
                    const arm = Math.abs(base.at[0]) >= .35 && base.at[1] >= .8 && base.at[1] <= 1.3
                    posed.at[0] = x + base.at[0]; posed.at[1] = base.at[1]
                    posed.at[2] = z + base.at[2] + (leg ? swing * .055 : arm ? -swing * .025 : 0)
                    posed.rotate![0] = (base.rotate?.[0] ?? 0) + (leg ? swing * .16 : arm ? -swing * .08 : 0)
                    posed.rotate![1] = base.rotate?.[1] ?? 0; posed.rotate![2] = base.rotate?.[2] ?? 0
                    buckets.get(key)!.push(posed)
                }
            }
        },
    }
}

function Scene({ session, reducedMotion, light, onReady, onFailure, running }: Props) {
    const { camera, gl, invalidate } = useThree()
    const actors = useMemo(() => makeActorBuffers(), [])
    const viewmodel = useRef<Group>(null), muzzle = useRef<Mesh>(null), feedback = useRef<Group>(null)
    const sparks = useRef<(Group | null)[]>([])
    const lastImpact = useRef(0), flashUntil = useRef(0)
    const fx = useRef(Array.from({ length: effectsCapacity }, () => ({ until: 0, x: 0, y: 0, z: 0, blocked: false, weak: false })))
    const nextFx = useRef(0)
    useEffect(() => {
        const canvas = gl.domElement
        const lost = (event: Event) => { event.preventDefault(); onFailure() }
        canvas.addEventListener('webglcontextlost', lost)
        onReady()
        return () => canvas.removeEventListener('webglcontextlost', lost)
    }, [gl, onReady, onFailure])
    useEffect(() => { lastImpact.current = 0; flashUntil.current = 0; nextFx.current = 0; for (const f of fx.current) f.until = 0 }, [session])
    useEffect(() => { invalidate() }, [invalidate, running, light, reducedMotion, session])
    // Negative priority fills buckets before child instance writers, without taking over rendering.
    useFrame(({ clock }) => {
        const { state, previous, alpha, direction, impact, effects } = session.read()
        camera.position.set(EYE.x / 1000, EYE.y / 1000, EYE.z / 1000)
        camera.lookAt(camera.position.x + direction.x, camera.position.y + direction.y, camera.position.z + direction.z)
        actors.update(state, previous, alpha, reducedMotion)
        for (const event of effects) {
            if (event.id <= lastImpact.current) continue
            lastImpact.current = event.id; flashUntil.current = clock.elapsedTime + .13
            if (event.impact.kind === 'miss') continue
            const f = fx.current[nextFx.current++ % effectsCapacity], hit = event.impact
            f.until = clock.elapsedTime + .3; f.x = hit.point.x / 1000; f.y = hit.point.y / 1000; f.z = hit.point.z / 1000
            f.blocked = hit.kind === 'shield'; f.weak = hit.kind === 'weak'
        }
        for (let i = 0; i < effectsCapacity; i++) {
            const node = sparks.current[i], f = fx.current[i]
            if (!node) continue
            const remaining = f.until - clock.elapsedTime
            node.visible = running && remaining > 0
            if (!node.visible) continue
            node.position.set(f.x, f.y + (reducedMotion ? 0 : (.3 - remaining) * .15), f.z + .008)
            node.quaternion.copy(camera.quaternion)
            const size = reducedMotion ? .08 : (.075 + (.3 - remaining) * .2) * (f.weak ? 1.5 : 1)
            node.scale.setScalar(size)
            // A cool ring is blocked metal, an amber star is damage, larger for a weak point.
            node.children[0].visible = f.blocked; node.children[1].visible = !f.blocked
        }
        const flashing = running && clock.elapsedTime < flashUntil.current
        if (viewmodel.current) {
            const reloading = state.reloadUntil ? Math.max(0, Math.min(1, 1 - (state.reloadUntil - state.tick - alpha) / RELOAD_TICKS)) : 0
            const dip = reducedMotion ? (state.reloadUntil ? 1 : 0) : Math.sin(Math.PI * reloading)
            viewmodel.current.position.copy(camera.position); viewmodel.current.quaternion.copy(camera.quaternion)
            viewmodel.current.translateX(.22 + dip * .06); viewmodel.current.translateY(-.33 - dip * .18); viewmodel.current.translateZ(-.62)
            if (!reducedMotion) { viewmodel.current.rotateZ(-dip * .32); viewmodel.current.rotateX(dip * .3) }
            if (flashing && !reducedMotion) viewmodel.current.translateZ(.04)
        }
        if (muzzle.current) muzzle.current.visible = flashing && !reducedMotion
        if (feedback.current) {
            feedback.current.position.copy(camera.position); feedback.current.quaternion.copy(camera.quaternion); feedback.current.translateZ(-1)
            feedback.current.visible = flashing && impact?.kind !== 'miss'
            feedback.current.children[0].visible = impact?.kind === 'shield'; feedback.current.children[1].visible = impact?.kind !== 'shield'
        }
    }, -1)
    const dusk = light === 'dusk'
    return <>
        <color attach="background" args={[dusk ? '#c1b6a9' : '#c8d1d5']} />
        <fog attach="fog" args={[dusk ? '#c1b6a9' : '#c8d1d5', 29, 68]} />
        <hemisphereLight args={[dusk ? '#ffe9cb' : '#ecf4ff', '#535852', 1.7]} />
        <directionalLight position={[-12, 18, 8]} color={dusk ? '#ffd4a4' : '#ffffff'} intensity={2.1} />
        <StaticBatches parts={street} />
        {actorKeys.map(key => {
            const [shape, finish] = key.split(':') as [Shape, Finish]
            return <DynamicBatch key={key} shape={shape} finish={finish} capacity={MAX_ENEMIES * 32} read={() => actors.read(key)} />
        })}
        <group ref={viewmodel}>
            <StaticBatches parts={weaponKit} />
            <mesh ref={muzzle} visible={false} position={[0, .015, -.48]}><sphereGeometry args={[.045, 6, 4]} /><meshBasicMaterial color="#ffdc8a" /></mesh>
        </group>
        {Array.from({ length: effectsCapacity }, (_, i) => <group key={i} ref={g => { sparks.current[i] = g }} visible={false}>
            <mesh><ringGeometry args={[.5, 1, 8]} /><meshBasicMaterial color="#9dd8ed" side={DoubleSide} /></mesh>
            <mesh rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[1.7, 1.7]} /><meshBasicMaterial color="#ffe0a1" side={DoubleSide} /></mesh>
        </group>)}
        <group ref={feedback} visible={false}>
            <mesh><ringGeometry args={[.018, .025, 4]} /><meshBasicMaterial color="#9cddf3" depthTest={false} side={DoubleSide} /></mesh>
            <group rotation={[0, 0, Math.PI / 4]}>
                <mesh><planeGeometry args={[.05, .004]} /><meshBasicMaterial color="#fff2ba" depthTest={false} /></mesh>
                <mesh><planeGeometry args={[.004, .05]} /><meshBasicMaterial color="#fff2ba" depthTest={false} /></mesh>
            </group>
        </group>
    </>
}
export default function FpsScene(props: Props) {
    return <Canvas className="fps-canvas" frameloop={props.running ? 'always' : 'demand'} dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'default' }} camera={{ position: [0, 1.65, 1.8], fov: 60, near: .05, far: 85 }}>
        <Scene {...props} />
    </Canvas>
}

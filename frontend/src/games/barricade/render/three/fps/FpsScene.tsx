import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DoubleSide, type Group, type Mesh } from 'three'
import { position, shieldUp } from '../../../sim/fps/collision'
import { AXIS_END, AXIS_START, CONTACT_Z, EYE, MAX_ENEMIES, SPAWN_Z } from '../../../sim/fps/types'
import type { Session } from '../../../fps/session'

type Props = { session: Session; running: boolean; reducedMotion: boolean; light: 'dusk' | 'day'; onReady: () => void; onFailure: () => void }

function Block({ at, size, color, rotation = 0 }: { at: [number, number, number]; size: [number, number, number]; color: string; rotation?: number }) {
    return <mesh position={at} rotation={[0, rotation, 0]}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
}

function Facade({ x, z, width, height, color }: { x: number; z: number; width: number; height: number; color: string }) {
    return <group position={[x, 0, z]}>
        <Block at={[0, height / 2, 0]} size={[width, height, 4]} color={color} />
        <Block at={[0, height + 0.35, 0]} size={[width + 0.4, 0.7, 4.4]} color="#35434a" />
        <Block at={[0, 2.6, 2.1]} size={[width + 0.2, 0.18, 0.3]} color="#d5c5ac" />
        {[3.8, 6.6, 9.4].filter(y => y < height).map(y => <group key={y}>
            {[-0.3, 0.3].map(col => <group key={col} position={[col * width, y, 2.06]}>
                <Block at={[0, 0, 0]} size={[1.25, 1.7, 0.12]} color="#2c3c42" />
                <Block at={[0, 0, 0.08]} size={[0.07, 1.7, 0.05]} color="#d0bfa2" />
                <Block at={[0, -0.35, 0.08]} size={[1.25, 0.06, 0.05]} color="#d0bfa2" />
                <Block at={[0, -0.95, 0.2]} size={[1.6, 0.16, 0.5]} color="#c5b293" />
            </group>)}
        </group>)}
        <Block at={[0, 1, 2.05]} size={[1.4, 2, 0.14]} color="#334847" />
    </group>
}

function Street() {
    return <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -18]}><planeGeometry args={[100, 100]} /><meshStandardMaterial color="#575651" roughness={1} /></mesh>
        {AXIS_START.map((start, axis) => {
            const sx = start / 1000, ex = AXIS_END[axis] / 1000, sz = SPAWN_Z / 1000, ez = CONTACT_Z / 1000
            const length = Math.hypot(sx - ex, sz - ez)
            return <group key={start} position={[(sx + ex) / 2, 0, (sz + ez) / 2]} rotation={[0, Math.atan2(sx - ex, sz - ez), 0]}>
                <Block at={[0, 0, 0]} size={[4.5, 0.035, length + 8]} color="#44484a" />
                {[-1, 1].map(side => <Block key={side} at={[side * 2.5, 0.06, 5]} size={[0.32, 0.12, length - 10]} color="#a69e8d" />)}
            </group>
        })}
        {[-1, 1].map(side => <group key={side}>
            <Facade x={side * 4.1} z={-16} width={2.4} height={11} color={side < 0 ? '#baa88e' : '#c3b8a0'} />
            <Facade x={side * 6} z={-25} width={5} height={14} color="#aa9a83" />
            <Facade x={side * 20} z={-20} width={6} height={12} color="#c0ad94" />
            <Block at={[side * 5.2, 2.7, -5.5]} size={[0.12, 5.4, 0.12]} color="#28383c" />
            <Block at={[side * 5.2, 5.4, -5.5]} size={[0.5, 0.55, 0.5]} color="#e4c88a" />
            <Block at={[side * 6, 0.5, -3]} size={[1.2, 1, 0.6]} color="#596952" />
        </group>)}
        <Facade x={0} z={-38} width={12} height={15} color="#ac9c84" />
        {/* Tricolour and a café awning: small, original civic cues, no texture downloads. */}
        <group position={[-4.1, 2.4, -13.8]}>
            <Block at={[0, 0, 0]} size={[2.4, 0.15, 1.3]} color="#354f48" />
            <Block at={[0, -0.28, 0.6]} size={[2.4, 0.5, 0.1]} color="#ede1c5" />
        </group>
        <group position={[3.6, 4.8, -13.4]}>
            {['#335578', '#e6e0d3', '#ab5146'].map((color, i) => <Block key={color} at={[i * 0.24, 0, 0]} size={[0.24, 0.65, 0.07]} color={color} />)}
        </group>
        <Block at={[0, 0.32, 0.15]} size={[6.8, 0.64, 0.8]} color="#635346" />
        {[-3, -2, -1, 0, 1, 2, 3].map((x, i) => <group key={x}>
            <Block at={[x, 0.74, 0.1]} size={[0.93, 0.2, 0.65]} color={i % 2 ? '#8c8168' : '#aca084'} rotation={i % 2 ? 0.09 : -0.06} />
            <Block at={[x, 0.3, 0.65]} size={[0.15, 0.85, 0.12]} color="#3a3028" rotation={0.25} />
        </group>)}
    </group>
}

function Crs() {
    return <group>
        <Block at={[0, 0.98, 0]} size={[0.65, 0.85, 0.5]} color="#24374a" />
        <Block at={[-0.2, 0.38, 0]} size={[0.22, 0.65, 0.25]} color="#1c2833" />
        <Block at={[0.2, 0.38, 0]} size={[0.22, 0.65, 0.25]} color="#1c2833" />
        <mesh position={[0, 1.65, 0]}><sphereGeometry args={[0.25, 12, 8]} /><meshStandardMaterial color="#263746" /></mesh>
        <Block at={[0, 1.6, 0.24]} size={[0.42, 0.22, 0.08]} color="#aabac1" />
        <Block at={[0, 1.38, 0.27]} size={[0.25, 0.07, 0.04]} color="#d9d4c5" />
        <Block at={[-0.44, 1.05, 0]} size={[0.18, 0.6, 0.22]} color="#26384b" />
        <Block at={[0.44, 1.05, 0]} size={[0.18, 0.6, 0.22]} color="#26384b" />
        {/* Shield group toggled below from the exact simulation shield window. */}
        <group name="shield">
            <Block at={[0, 0.96, 0.42]} size={[0.94, 0.92, 0.08]} color="#6b8797" />
            <Block at={[0, 1.16, 0.47]} size={[0.8, 0.08, 0.015]} color="#dedfd8" />
            <Block at={[0, 0.8, 0.47]} size={[0.8, 0.08, 0.015]} color="#dedfd8" />
        </group>
    </group>
}
function Robot() {
    return <group>
        <Block at={[0, 1.15, 0]} size={[0.94, 1.15, 0.8]} color="#879392" />
        <Block at={[0, 1.7, 0]} size={[0.72, 0.4, 0.6]} color="#535e60" />
        <Block at={[0, 1.315, 0.445]} size={[0.36, 0.33, 0.06]} color="#f1b264" />
        <Block at={[-0.3, 0.32, 0]} size={[0.24, 0.64, 0.36]} color="#384449" />
        <Block at={[0.3, 0.32, 0]} size={[0.24, 0.64, 0.36]} color="#384449" />
        <Block at={[-0.6, 1.05, 0]} size={[0.25, 0.6, 0.25]} color="#697676" />
        <Block at={[0.6, 1.05, 0]} size={[0.25, 0.6, 0.25]} color="#697676" />
    </group>
}

function Scene({ session, reducedMotion, light, onReady, onFailure, running }: Props) {
    const { camera, gl, invalidate } = useThree()
    const pool = useRef<(Group | null)[]>([])
    const viewmodel = useRef<Group>(null)
    const spark = useRef<Mesh>(null)
    const muzzle = useRef<Mesh>(null)
    const feedback = useRef<Group>(null)
    const lastImpact = useRef(0)
    const flashUntil = useRef(0)
    useEffect(() => {
        const canvas = gl.domElement
        const lost = (event: Event) => { event.preventDefault(); onFailure() }
        canvas.addEventListener('webglcontextlost', lost)
        onReady()
        return () => canvas.removeEventListener('webglcontextlost', lost)
    }, [gl, onReady, onFailure])
    useEffect(() => { invalidate() }, [invalidate, running, light, reducedMotion, session])
    useFrame(({ clock }) => {
        const { state, previous, alpha, direction, impact, impactId } = session.read()
        camera.position.set(EYE.x / 1000, EYE.y / 1000, EYE.z / 1000)
        camera.lookAt(camera.position.x + direction.x, camera.position.y + direction.y, camera.position.z + direction.z)
        if (viewmodel.current) {
            viewmodel.current.position.copy(camera.position)
            viewmodel.current.quaternion.copy(camera.quaternion)
            viewmodel.current.translateX(0.24)
            viewmodel.current.translateY(state.reloadUntil ? -0.53 : -0.4)
            viewmodel.current.translateZ(-0.68)
        }
        for (let i = 0; i < MAX_ENEMIES; i++) {
            const group = pool.current[i], e = state.enemies[i]
            if (!group) continue
            group.visible = !!e
            if (!e) continue
            const now = position(e), before = previous.enemies.find(p => p.id === e.id)
            const prior = before ? position(before) : now
            group.position.set((prior.x + (now.x - prior.x) * alpha) / 1000, 0, (prior.z + (now.z - prior.z) * alpha) / 1000)
            group.children[0].visible = e.kind === 'crs'
            group.children[1].visible = e.kind === 'robot'
            const shield = group.children[0].getObjectByName('shield')
            if (shield) shield.visible = shieldUp(e, state.tick)
        }
        if (impact && impactId !== lastImpact.current) {
            lastImpact.current = impactId; flashUntil.current = clock.elapsedTime + 0.12
            if (spark.current) spark.current.position.set(impact.point.x / 1000, impact.point.y / 1000, impact.point.z / 1000)
        }
        const flashing = running && clock.elapsedTime < flashUntil.current
        if (spark.current) spark.current.visible = flashing && impact?.kind !== 'miss'
        if (muzzle.current) muzzle.current.visible = flashing && !reducedMotion
        if (feedback.current) {
            feedback.current.position.copy(camera.position)
            feedback.current.quaternion.copy(camera.quaternion)
            feedback.current.translateZ(-1)
            feedback.current.visible = flashing && impact?.kind !== 'miss'
            feedback.current.children[0].visible = impact?.kind === 'shield'
            feedback.current.children[1].visible = impact?.kind !== 'shield'
        }
        if (viewmodel.current && flashing && !reducedMotion) viewmodel.current.translateZ(0.045)
    })
    const dusk = light === 'dusk'
    return <>
        <color attach="background" args={[dusk ? '#b9aa93' : '#bbc8cf']} />
        <fog attach="fog" args={[dusk ? '#b9aa93' : '#bbc8cf', 30, 65]} />
        <hemisphereLight args={[dusk ? '#ffdfba' : '#edf5ff', '#424945', 2.3]} />
        <directionalLight position={[-10, 18, 12]} color={dusk ? '#ffca8e' : '#ffffff'} intensity={2.2} />
        <Street />
        {Array.from({ length: MAX_ENEMIES }, (_, i) => <group key={i} visible={false} ref={g => { pool.current[i] = g }}><Crs /><Robot /></group>)}
        <group ref={viewmodel}>
            <Block at={[0, -0.04, 0]} size={[0.17, 0.18, 0.5]} color="#304348" />
            <Block at={[0, 0.055, -0.32]} size={[0.07, 0.075, 0.25]} color="#26363a" />
            <Block at={[0, 0.16, -0.1]} size={[0.018, 0.08, 0.04]} color="#c2c7b5" />
            <Block at={[0.04, -0.18, 0.08]} size={[0.14, 0.17, 0.15]} color="#b08d73" />
            <Block at={[-0.13, -0.14, -0.2]} size={[0.13, 0.14, 0.19]} color="#b08d73" />
            <Block at={[0.12, -0.25, 0.25]} size={[0.2, 0.2, 0.45]} color="#4c655f" />
            <mesh ref={muzzle} visible={false} position={[0, 0.055, -0.49]}><sphereGeometry args={[0.075, 6, 4]} /><meshBasicMaterial color="#ffdc8a" /></mesh>
        </group>
        <mesh ref={spark} visible={false}><sphereGeometry args={[0.1, 8, 6]} /><meshBasicMaterial color="#ffe0a5" /></mesh>
        <group ref={feedback} visible={false}>
            <mesh><ringGeometry args={[0.018, 0.025, 4]} /><meshBasicMaterial color="#9cddf3" depthTest={false} side={DoubleSide} /></mesh>
            <group rotation={[0, 0, Math.PI / 4]}>
                <mesh><planeGeometry args={[0.05, 0.004]} /><meshBasicMaterial color="#fff2ba" depthTest={false} /></mesh>
                <mesh><planeGeometry args={[0.004, 0.05]} /><meshBasicMaterial color="#fff2ba" depthTest={false} /></mesh>
            </group>
        </group>
    </>
}
export default function FpsScene(props: Props) {
    return <Canvas className="fps-canvas" frameloop={props.running ? 'always' : 'demand'} dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'default' }} camera={{ position: [0, 1.65, 1.8], fov: 65, near: 0.05, far: 80 }}>
        <Scene {...props} />
    </Canvas>
}

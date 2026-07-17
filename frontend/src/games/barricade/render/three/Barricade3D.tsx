/**
 * Barricade3D.tsx — the real 3D bake-off arm (Phase 0, PR-0c). LAZY-loaded so the
 * `three` / react-three-fiber stack lands in the async `vendor-three` chunk (bundle
 * CI gate + Workbox precache-exclusion enforce isolation), NEVER the eager bundle.
 *
 * It reads the sim → 3D bridge (useSimSnapshots) each frame and renders the front
 * line in TRUE 3D: a receding ground, a defender's parapet in the foreground, the
 * Order machines advancing down-lane, a rebel at the wall. fiber-ONLY (no drei) to
 * keep the added dep tree small + all-MIT; the bold ink edges are inverted-hull
 * outlines (a scaled back-face shell), which match the Riso per-object ink look.
 *
 * Render-ONLY: it never advances or mutates the sim (that stays in the one
 * useGameLoop advance path); the snapshot bridge is copy-on-write + dev-frozen. The
 * deterministic sim, its replay log, and the G3 verifier are untouched.
 *
 * SPIKE scope: machines share one parametric mesh distinguished by the exact 2D
 * MACHINE_COLOR + size — enough to answer "does dimensionality read better?" Real
 * per-archetype 3D art is a separate, owner-gated drop (like the 2.5D arm's bust).
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import { useRef } from "react"
import { BackSide, type Group } from "three"
import { LANES } from "../../sim/types"
import { MACHINE_COLOR } from "../draw"
import type { SnapshotStore } from "./bridge/useSimSnapshots"
import { laneX, FIELD_DEPTH, LANE_SPACING, groundRaycastToLaneDist } from "./scene/coords"
import { enemyPlacements, MAX_SLOTS } from "./scene/placements"

const STOCK = "#141026"
const INK = "#0a0812"
const VERMILION = "#e0392b"
const OCHRE = "#dba43c"

// A flat-shaded machine placeholder facing the wall: body + a frontal shield plate
// + a vermilion sensor eye, wrapped in an inverted-hull ink outline. One geometry
// for every archetype (the spike varies color + scale only — see the file header).
function MachineSlots({ groupRefs }: { groupRefs: { current: (Group | null)[] } }) {
    return (
        <>
            {Array.from({ length: MAX_SLOTS }, (_, i) => (
                <group
                    key={i}
                    ref={(g) => {
                        groupRefs.current[i] = g
                    }}
                    visible={false}
                >
                    {/* inverted-hull ink outline (back-face shell, slightly larger) */}
                    <mesh scale={1.09}>
                        <boxGeometry args={[0.9, 0.9, 0.9]} />
                        <meshBasicMaterial color={INK} side={BackSide} />
                    </mesh>
                    {/* body — its color is driven per-frame in useFrame */}
                    <mesh castShadow>
                        <boxGeometry args={[0.9, 0.9, 0.9]} />
                        <meshStandardMaterial flatShading />
                    </mesh>
                    {/* frontal riot shield (faces the wall, +Z) */}
                    <mesh position={[0, 0.05, 0.5]}>
                        <boxGeometry args={[1.0, 1.0, 0.08]} />
                        <meshStandardMaterial color="#8ea6dd" flatShading />
                    </mesh>
                    {/* the sensor eye */}
                    <mesh position={[0, 0.18, 0.56]}>
                        <sphereGeometry args={[0.1, 12, 12]} />
                        <meshBasicMaterial color={VERMILION} />
                    </mesh>
                </group>
            ))}
        </>
    )
}

/**
 * Drives the machine pool imperatively from the sim snapshot every frame — position,
 * scale, colour, visibility — so the enemy SET changing (spawns/deaths) never forces
 * a 60Hz React re-render; React only owns the static pool. Interpolation reuses the
 * exact 2D `interpPositions`, so 3D and 2D place a unit at the identical sub-tick pos.
 */
function EnemyField({ store }: { store: SnapshotStore }) {
    const groupRefs = useRef<(Group | null)[]>([])

    useFrame(() => {
        const placements = enemyPlacements(store.read()) // pure + unit-tested
        const groups = groupRefs.current
        for (let i = 0; i < MAX_SLOTS; i++) {
            const g = groups[i]
            if (!g) continue
            const p = placements[i]
            if (!p) {
                g.visible = false
                continue
            }
            const scale = (p.archetype === "broadcast" ? 1.5 : 1) * (0.55 + 0.35 * p.hpFrac)
            const flyer = p.archetype === "drone" || p.archetype === "swarm" || p.archetype === "jammer"
            g.position.set(p.x, flyer ? 0.9 : 0.45 * scale, p.z)
            g.scale.setScalar(scale)
            g.visible = true
            // body material is the 2nd child (0 = outline shell); recolor per archetype
            const body = g.children[1] as unknown as { material: { color: { set(c: string): void } } }
            body.material.color.set(MACHINE_COLOR[p.archetype])
        }
    })

    return <MachineSlots groupRefs={groupRefs} />
}

/** The receding ground: a dark stock plane + alternating lane tints + ink dividers. */
function Ground() {
    const halfW = (LANES * LANE_SPACING) / 2
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -FIELD_DEPTH / 2 + 0.5]} receiveShadow>
                <planeGeometry args={[LANES * LANE_SPACING + 1, FIELD_DEPTH + 2]} />
                <meshStandardMaterial color={STOCK} flatShading />
            </mesh>
            {Array.from({ length: LANES }, (_, i) =>
                i % 2 === 1 ? (
                    <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[laneX(i), 0.01, -FIELD_DEPTH / 2 + 0.5]}>
                        <planeGeometry args={[LANE_SPACING, FIELD_DEPTH + 2]} />
                        <meshBasicMaterial color="#191234" />
                    </mesh>
                ) : null,
            )}
            {Array.from({ length: LANES + 1 }, (_, i) => (
                <mesh key={`d${i}`} position={[-halfW + i * LANE_SPACING, 0.02, -FIELD_DEPTH / 2 + 0.5]}>
                    <boxGeometry args={[0.04, 0.02, FIELD_DEPTH + 2]} />
                    <meshBasicMaterial color={i === 0 || i === LANES ? OCHRE : VERMILION} />
                </mesh>
            ))}
        </group>
    )
}

/** The defender's parapet across the near foreground (Z≈0.7), + sandbag merlons. */
function Parapet() {
    const halfW = (LANES * LANE_SPACING) / 2 + 0.3
    return (
        <group position={[0, 0, 0.9]}>
            <mesh position={[0, 0.35, 0]} castShadow>
                <boxGeometry args={[halfW * 2, 0.7, 0.4]} />
                <meshStandardMaterial color="#1a1330" flatShading />
            </mesh>
            {Array.from({ length: 7 }, (_, i) => (
                <mesh key={i} position={[-halfW + 0.4 + (i + 0.5) * ((halfW * 2 - 0.8) / 7), 0.78, 0]}>
                    <boxGeometry args={[(halfW * 2 - 0.8) / 7 - 0.06, 0.22, 0.42]} />
                    <meshStandardMaterial color={i % 2 ? "#2a2140" : OCHRE} flatShading />
                </mesh>
            ))}
        </group>
    )
}

/** The rebel at the wall — a warm bust that tracks the player's lane. */
function RebelBust({ store }: { store: SnapshotStore }) {
    const ref = useRef<Group | null>(null)
    useFrame(() => {
        const next = store.read().next
        if (ref.current && next) ref.current.position.x = laneX(next.playerLane)
    })
    return (
        <group ref={ref} position={[laneX(Math.floor(LANES / 2)), 0.5, 1.2]}>
            <mesh>
                <capsuleGeometry args={[0.28, 0.3, 4, 12]} />
                <meshStandardMaterial color={VERMILION} flatShading />
            </mesh>
            <mesh position={[0, 0.45, 0]}>
                <sphereGeometry args={[0.24, 16, 16]} />
                <meshStandardMaterial color={OCHRE} flatShading />
            </mesh>
            {/* tricolore bandana */}
            <mesh position={[0, 0.5, 0.16]}>
                <boxGeometry args={[0.5, 0.12, 0.3]} />
                <meshStandardMaterial color="#2b49a0" flatShading />
            </mesh>
        </group>
    )
}

function Scene({ store, onGroundTap }: { store: SnapshotStore; onGroundTap: (lane: number, dist: number) => void }) {
    const { camera } = useThree()
    const handleDown = (e: ThreeEvent<PointerEvent>) => {
        // Reuse the SAFETY-CRITICAL raycast: integer (lane, dist) in the 2D domain,
        // or null on a degenerate ray. Never a smuggled float (silent-misfire class).
        const res = groundRaycastToLaneDist({ x: e.pointer.x, y: e.pointer.y }, camera)
        if (res) onGroundTap(res.lane, res.dist)
    }
    return (
        <>
            <fog attach="fog" args={[STOCK, 6, FIELD_DEPTH + 4]} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[3, 8, 4]} intensity={1.1} castShadow />
            {/* a big invisible ground catcher for taps across the whole field */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -FIELD_DEPTH / 2]} onPointerDown={handleDown}>
                <planeGeometry args={[40, 40]} />
                <meshBasicMaterial visible={false} />
            </mesh>
            <Ground />
            <Parapet />
            <EnemyField store={store} />
            <RebelBust store={store} />
        </>
    )
}

/**
 * The mounted 3D renderer. Camera sits behind + above the barricade (near, Z>0)
 * looking down the field toward the far spawn (Z=-FIELD_DEPTH). `flat` disables ACES
 * tone-mapping so the flat riso colours read as authored (not muted).
 */
export default function Barricade3D({
    store,
    onGroundTap,
}: {
    store: SnapshotStore
    onGroundTap: (lane: number, dist: number) => void
}) {
    return (
        <Canvas
            className="bar-canvas"
            flat
            shadows
            dpr={[1, 2]}
            gl={{ antialias: true }}
            camera={{ position: [0, 3.6, 5.2], fov: 52, near: 0.1, far: 60 }}
            onCreated={({ camera }) => camera.lookAt(0, 0.4, -4)}
        >
            <color attach="background" args={[STOCK]} />
            <Scene store={store} onGroundTap={onGroundTap} />
        </Canvas>
    )
}

import { AXIS_START, AXIS_END, SPAWN_Z, CONTACT_Z } from '../../../sim/fps/types'

/** Original procedural C2 kit. Metres; no simulation input and no external assets. */
export type V3 = [number, number, number]
export type Shape = 'box' | 'sphere' | 'cylinder'
export type Finish = 'stone' | 'asphalt' | 'wood' | 'metal' | 'cloth' | 'glass' | 'light'
export type Part = { shape: Shape; finish: Finish; color: string; at: V3; size: V3; rotate?: V3 }
export const part = (finish: Finish, color: string, at: V3, size: V3, shape: Shape = 'box', rotate?: V3): Part => ({ finish, color, at, size, shape, rotate })
export const batchKey = (p: Part) => `${p.shape}:${p.finish}`

/** Facades flank the three original approach rays; no collision scenery is introduced. */
export function streetKit(): Part[] {
    const p: Part[] = [], add = (...parts: Part[]) => p.push(...parts)
    add(part('stone', '#85887e', [0, -.08, -23], [78, .12, 78]))
    AXIS_START.forEach((start, axis) => {
        const sx = start / 1000, ex = AXIS_END[axis] / 1000, sz = SPAWN_Z / 1000, ez = CONTACT_Z / 1000
        const length = Math.hypot(sx - ex, sz - ez), angle = Math.atan2(sx - ex, sz - ez)
        const x = (sx + ex) / 2, z = (sz + ez) / 2
        add(part('asphalt', '#414b52', [x, -.005, z], [4.4, .025, length + 12], 'box', [0, angle, 0]))
        for (const side of [-1, 1]) {
            const localX = side * 2.3, localZ = 5
            add(part('stone', '#b2b3a8', [x + Math.cos(angle) * localX + Math.sin(angle) * localZ, .045, z - Math.sin(angle) * localX + Math.cos(angle) * localZ], [.16, .12, length - 10], 'box', [0, angle, 0]))
        }
    })
    // Two narrow islands separate the three approaches, with outer street walls behind.
    for (const side of [-1, 1]) {
        facade(side * 4.6, -18, 3.2, 8.8, side < 0 ? '#c3b8a2' : '#cfc6b2', 0)
        facade(side * 7.4, -26, 4.4, 11.8, '#b5b1a6', 1)
        facade(side * 20, -19, 6.2, 11.8, '#d1c4ac', 2)
        facade(side * 26, -26, 5.8, 14.8, '#b7b3ab', 3)
        // Trees are deliberately omitted: the approach silhouette must remain unobstructed.
        add(part('metal', '#30383b', [side * 5.4, 2.4, -7], [.09, 4.8, .09], 'cylinder'),
            part('metal', '#30383b', [side * 5.4, .16, -7], [.28, .32, .28], 'cylinder'),
            part('metal', '#30383b', [side * 5.4, 4.62, -7], [.42, .12, .42]),
            part('glass', '#e8dcc1', [side * 5.4, 4.86, -7], [.27, .4, .27]),
            part('metal', '#30383b', [side * 5.4, 5.11, -7], [.42, .1, .42]),
            part('metal', '#536663', [side * 5.8, .48, -4.4], [.58, .9, .58], 'cylinder'),
            part('metal', '#293b3a', [side * 5.8, .96, -4.4], [.66, .1, .66], 'cylinder'))
        for (let z = -10; z > -28; z -= 4) {
            const x = side * (3.25 + (-z - 10) * .34)
            add(part('stone', '#a7a79e', [x, .035, z], [.15, .07, .5]))
        }
    }
    // Distant skyline gives the vanishing point depth beyond the actual spawn line.
    facade(0, -45, 8, 14.8, '#b7b6ad', 4)
    facade(-10, -43, 7, 17.8, '#aaafa9', 5)
    facade(10, -43, 7, 11.8, '#c2b8a6', 6)
    // Café canopy and tricolour, original geometry, no real commercial branding.
    add(part('cloth', '#365c55', [-4.6, 2.5, -14.75], [3.3, .12, 1.4], 'box', [.12, 0, 0]),
        part('cloth', '#e2d6b7', [-4.6, 2.3, -14.12], [3.3, .32, .08]))
    for (let i = 0; i < 9; i++) add(part('cloth', '#365c55', [-6.05 + i * .36, 2.3, -14.07], [.18, .3, .035]))
    add(part('metal', '#62635b', [4, 4.2, -14.55], [.025, 1.5, .025], 'cylinder', [0, 0, -.25]))
    ;['#365986', '#e8e3d8', '#a34942'].forEach((color, i) => add(part('cloth', color, [4.1 + i * .19, 4.4, -14.45], [.19, .52, .02])))
    // Low original barricade. Gaps, slanted braces and overlapping bags replace a solid slab.
    for (let i = 0; i < 9; i++) {
        const x = (i - 4) * .76
        add(part('wood', i % 2 ? '#75634d' : '#8f7757', [x, .37, .05], [.72, .59, .32]),
            part('wood', '#504333', [x + .2, .32, .32], [.095, .9, .08], 'box', [0, 0, i % 2 ? .18 : -.16]),
            part('cloth', i % 2 ? '#9a957b' : '#b1a58a', [x, .73, .08], [.79, .28, .58], 'sphere', [0, i * .07, .04]),
            part('cloth', '#ada58a', [x + .22, .91, .03], [.56, .2, .49], 'sphere', [0, -.1, -.03]))
        for (const y of [.19, .42, .59]) add(part('metal', '#3a3933', [x + .21, y, .373], [.025, .025, .014], 'cylinder', [Math.PI / 2, 0, 0]))
    }
    return p

    function facade(x: number, z: number, width: number, height: number, color: string, variation: number) {
        const front = z + 2.4
        add(part('stone', color, [x, height / 2, z], [width, height, 4.8]),
            part('stone', '#96958c', [x, .08, front + .4], [width + .35, .16, 1.15]),
            part('stone', '#b5aea0', [x, .65, front + .04], [width + .03, 1.3, .12]),
            part('metal', '#545d64', [x, height + .58, z + 1.2], [width + .18, .1, 2.7], 'box', [.4, 0, 0]),
            part('metal', '#48555c', [x, height + .58, z - 1.2], [width + .18, .1, 2.7], 'box', [-.4, 0, 0]),
            part('stone', '#918b7b', [x + width * .28, height + 1, z - 1.2], [.52, 1.4, .52]))
        for (const y of [2.7, height, height + .17]) add(part('stone', '#ded4bc', [x, y, front + .12], [width + .25, .16, .4]))
        // Realistic storey pitch and door dimensions. Windows recessed into framed openings.
        const columns = width > 5 ? [-.32, 0, .32] : [-.25, .25]
        for (let y = 4; y < height - .5; y += 3) {
            add(part('stone', '#b3ac9b', [x, y - 1.15, front + .045], [width, .055, .055]))
            for (const c of columns) {
                const wx = x + width * c
                add(part('stone', '#e0d6bf', [wx, y, front + .05], [1.03, 1.79, .16]),
                    part('glass', variation % 2 ? '#34494e' : '#29414a', [wx, y, front + .15], [.83, 1.58, .03]),
                    part('wood', '#bac3bb', [wx, y, front + .2], [.05, 1.57, .05]),
                    part('wood', '#bac3bb', [wx, y + .2, front + .2], [.83, .05, .05]),
                    part('stone', '#d8cbb1', [wx, y - .93, front + .22], [1.18, .12, .4]))
                if (variation % 2 === 0) for (const side of [-1, 1]) add(part('wood', '#697b75', [wx + side * .64, y, front + .13], [.24, 1.58, .09]))
                if (y < 5 || y > height - 4) {
                    add(part('stone', '#aba795', [wx, y - .78, front + .46], [1.23, .12, .69]),
                        part('metal', '#38454a', [wx, y - .25, front + .8], [1.2, .055, .05]))
                    for (let bar = -2; bar <= 2; bar++) add(part('metal', '#38454a', [wx + bar * .22, y - .51, front + .8], [.028, .55, .028]))
                }
            }
        }
        add(part('stone', '#ded0b7', [x, 1.15, front + .07], [1.18, 2.3, .2]),
            part('wood', '#435a55', [x, 1.075, front + .2], [.96, 2.15, .1]),
            part('glass', '#31474b', [x, 1.61, front + .27], [.66, .64, .025]),
            part('metal', '#b19c6b', [x + .32, .99, front + .3], [.035, .16, .04]))
        for (const side of [-1, 1]) {
            const edge = x + side * (width / 2 - .08)
            for (let y = .3; y < height; y += .6) add(part('stone', '#d4cab6', [edge, y, front + .04], [.23, .52, .1]))
            add(part('metal', '#677170', [edge, height / 2, front + .23], [.055, height, .055], 'cylinder'))
        }
    }
}

/** Character hulls/sensors stay fixed; only decorative limbs articulate. */
export function actorKit(kind: 'crs' | 'robot', walk: number, shield: boolean): Part[] {
    const p: Part[] = [], add = (...parts: Part[]) => p.push(...parts)
    if (kind === 'crs') {
        add(part('cloth', '#243d58', [0, 1.03, 0], [.62, .76, .46]),
            part('metal', '#293743', [0, 1.14, .19], [.54, .43, .13]),
            part('cloth', '#344a60', [0, .64, 0], [.49, .21, .4]),
            part('metal', '#273b50', [0, 1.67, 0], [.47, .4, .48], 'sphere'),
            part('metal', '#405773', [0, 1.78, -.01], [.47, .1, .43], 'sphere'),
            part('glass', '#8faebd', [0, 1.615, .248], [.42, .18, .055]),
            part('cloth', '#bac8c8', [0, 1.39, .258], [.2, .035, .018]))
        for (const side of [-1, 1]) {
            const swing = Math.sin(walk + (side < 0 ? Math.PI : 0)) * .23
            add(part('cloth', '#263a50', [side * .18, .4, swing * .35], [.2, .54, .23], 'box', [swing, 0, 0]),
                part('metal', '#364658', [side * .18, .36, .135 + swing * .35], [.18, .19, .06]),
                part('metal', '#192831', [side * .18, .1, .07 + swing * .7], [.23, .18, .33]),
                part('cloth', '#2c435b', [side * .365, 1.12, -.04], [.16, .35, .2], 'box', [-swing * .5, 0, side * .15]),
                part('metal', '#2d3c47', [side * .39, .9, .11], [.14, .23, .19], 'box', [-.55, 0, 0]))
        }
        if (shield) {
            // Exact outer authoritative extent: x ±.47, y .50–1.42, z .38–.46.
            add(part('metal', '#526d7c', [0, .96, .42], [.94, .92, .08]),
                part('glass', '#96aeb8', [0, 1.255, .465], [.74, .18, .012]),
                part('metal', '#d0dbd9', [0, 1.1, .469], [.66, .05, .009]),
                part('metal', '#304655', [0, .55, .466], [.85, .09, .014]))
        } else {
            // Lowered arm, no decorative shield in front of an unshielded collider.
            add(part('metal', '#526d7c', [-.405, .71, -.12], [.12, .52, .29]))
        }
    } else {
        add(part('metal', '#788d91', [0, 1.13, -.025], [.89, 1.06, .73]),
            part('metal', '#465e69', [0, 1.68, -.015], [.67, .35, .57]),
            part('glass', '#b7d9dc', [0, 1.72, .28], [.44, .055, .03]),
            part('metal', '#31424c', [0, .62, .16], [.57, .22, .47]),
            // Exact original frontal sensor extent .36×.33×.06; never animated.
            part('light', '#ffd18a', [0, 1.315, .44], [.36, .33, .06]),
            part('metal', '#2e4652', [0, 1.04, .36], [.54, .055, .035]))
        for (const side of [-1, 1]) {
            const swing = Math.sin(walk + (side < 0 ? Math.PI : 0)) * .3
            add(part('metal', '#4b6570', [side * .31, .43, swing * .24], [.17, .44, .26], 'box', [swing, 0, 0]),
                part('metal', '#afbdba', [side * .31, .48, .14 + swing * .24], [.22, .14, .1], 'cylinder', [Math.PI / 2, 0, 0]),
                part('metal', '#344a54', [side * .31, .15, .09 + swing * .6], [.29, .24, .39]),
                part('metal', '#a3b5b3', [side * .5, 1.27, -.035], [.19, .23, .23], 'sphere'),
                part('metal', '#455e67', [side * .52, 1.02, .025], [.14, .36, .2], 'box', [-swing * .55, 0, side * .08]),
                part('metal', '#b4c0bb', [side * .52, .81, .08], [.17, .12, .2]))
        }
        for (const x of [-.27, .27]) for (const y of [.82, 1.56]) add(part('metal', '#c3d0ca', [x, y, .367], [.05, .05, .022], 'cylinder', [Math.PI / 2, 0, 0]))
    }
    return p
}

export const weaponKit: Part[] = [
    part('metal', '#3c5159', [0, -.02, 0], [.12, .14, .4]),
    part('metal', '#26363d', [0, .015, -.32], [.047, .047, .29], 'cylinder', [Math.PI / 2, 0, 0]),
    part('wood', '#615645', [0, -.05, .28], [.09, .14, .26]),
    part('metal', '#202e35', [0, .085, -.1], [.016, .055, .03]),
    part('metal', '#8fa0a1', [0, .095, -.4], [.013, .025, .016]),
    part('metal', '#344b55', [.018, -.165, -.035], [.055, .18, .08], 'box', [0, 0, -.1]),
    part('cloth', '#495e58', [.08, -.25, .22], [.18, .18, .43], 'box', [-.13, 0, -.1]),
    part('cloth', '#33433f', [.027, -.14, .08], [.13, .14, .14], 'sphere'),
    part('cloth', '#33433f', [-.085, -.14, -.2], [.12, .12, .16], 'sphere'),
]

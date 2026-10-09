import { AXIS_START, AXIS_END, SPAWN_Z, CONTACT_Z } from '../../../sim/fps/types'

/** Original procedural C3 proposal. Metres; no simulation input and no external assets. */
export type V3 = [number, number, number]
export type Shape = 'box' | 'sphere' | 'cylinder'
export type Finish = 'stone' | 'asphalt' | 'wood' | 'metal' | 'cloth' | 'glass' | 'light'
export type Part = { shape: Shape; finish: Finish; color: string; at: V3; size: V3; rotate?: V3; motion?: 'leg' | 'arm'; rotationOrder?: 'XYZ' | 'YXZ' }
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
    // A continuous urban street, not freestanding towers. Central-front walls
    // start beyond the narrow junction; outer rows follow the diagonal roads.
    // Each rotated facade keeps its full footprint clear of all approach rays.
    const colors = ['#b5ab96', '#c4b99f', '#a7a799', '#b7aca3', '#a4aaa4']
    for (const side of [-1, 1]) {
        let end = -17.8
        for (let i = 0; i < 4; i++) {
            const width = [6.4, 7.2, 6.8, 8][i], z = end - width / 2
            placedFacade(side * 5.7, z, width, [10, 13, 11, 15][i], colors[i], i, -side * Math.PI / 2)
            end -= width // Party walls touch; cornices and heights vary.
        }
        const angle = side * Math.atan2(12.2, 26.4)
        let distance = 0
        for (let i = 0; i < 5; i++) {
            const width = [6.2, 7.4, 6.6, 7.2, 8][i]
            const along = distance + width / 2, z = -10 - along * Math.cos(angle)
            const x = side * 10.8 + along * Math.sin(angle)
            placedFacade(x, z, width, [10, 12.5, 11, 15, 13][i], colors[(i + 2) % colors.length], i + 2, -side * Math.PI / 2 + angle)
            distance += width
        }
        // Low kerbs and paving at the foreground corners reinforce perspective.
        add(part('stone', '#a7a99c', [side * 11.8, .055, -6], [5.6, .16, 10]))
        for (let z = -10; z <= -2; z += 1.25) add(part('stone', '#7a827d', [side * 11.8, .14, z], [5.5, .006, .025]))
        add(part('metal', '#30383b', [side * 6.8, 2.4, -9], [.09, 4.8, .09], 'cylinder'),
            part('metal', '#30383b', [side * 6.8, .16, -9], [.28, .32, .28], 'cylinder'),
            part('metal', '#30383b', [side * 6.8, 4.62, -9], [.42, .12, .42]),
            part('glass', '#e8dcc1', [side * 6.8, 4.86, -9], [.27, .4, .27]),
            part('metal', '#30383b', [side * 6.8, 5.11, -9], [.42, .1, .42]))
    }
    // Continuous background beyond spawn; no gameplay target travels into it.
    let edge = -39
    for (let i = 0; i < 10; i++) {
        const width = [7.2, 8.1, 7.8][i % 3]
        facade(edge + width / 2, -51, width, [15, 19, 13, 17][i % 4], colors[i % 5], i, false)
        edge += width
    }
    // Joined asphalt intersection, worn lane markings, drains and road repairs.
    add(part('asphalt', '#414b52', [0, -.004, -3.8], [18, .025, 12]),
        part('asphalt', '#3c464c', [-3.4, .011, -5.2], [1.7, .008, 2.4], 'box', [0, .15, 0]),
        part('metal', '#596561', [2.3, .014, -7.1], [.72, .015, .72], 'cylinder'))
    for (const x of [-4, -2.4, -.8, .8, 2.4, 4]) add(part('stone', '#a5aa9b', [x, .014, -8.8], [.65, .01, 1.4]))
    for (let z = -14; z > -40; z -= 6) add(part('stone', '#b9b6a2', [0, .014, z], [.085, .012, 1.7]))
    for (const side of [-1, 1]) for (let z = -14; z > -28; z -= 6) {
        const x = side * (1.8 + (-z - 1.6) * 12.2 / 26.4 + 2.1)
        add(part('metal', '#505c59', [x, .06, z], [.24, .025, .55]))
        for (let slot = -2; slot <= 2; slot++) add(part('asphalt', '#303d40', [x, .075, z + slot * .085], [.18, .008, .025]))
    }
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

    function placedFacade(x: number, z: number, width: number, height: number, color: string, variation: number, angle: number) {
        const start = p.length
        facade(0, 0, width, height, color, variation, Math.hypot(x, z) < 29)
        const c = Math.cos(angle), sn = Math.sin(angle)
        for (let i = start; i < p.length; i++) {
            const piece = p[i], [px, py, pz] = piece.at
            piece.at = [x + c * px + sn * pz, py, z - sn * px + c * pz]
            // Apply local roof pitch first, then rotate the whole facade around Y.
            piece.rotate = [piece.rotate?.[0] ?? 0, angle, piece.rotate?.[2] ?? 0]
            piece.rotationOrder = 'YXZ'
        }
    }

    function facade(x: number, z: number, width: number, height: number, color: string, variation: number, detailed = true) {
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
                    ...(detailed ? [part('wood', '#bac3bb', [wx, y, front + .2], [.05, 1.57, .05]),
                    part('wood', '#bac3bb', [wx, y + .2, front + .2], [.83, .05, .05]),
                    part('stone', '#d8cbb1', [wx, y - .93, front + .22], [1.18, .12, .4])] : []))
                if (detailed && variation % 2 === 0) for (const side of [-1, 1]) add(part('wood', '#697b75', [wx + side * .64, y, front + .13], [.24, 1.58, .09]))
                if (detailed && (y < 5 || y > height - 4)) {
                    add(part('stone', '#aba795', [wx, y - .78, front + .46], [1.23, .12, .69]),
                        part('metal', '#38454a', [wx, y - .25, front + .8], [1.2, .055, .05]))
                    for (let bar = -1; bar <= 1; bar++) add(part('metal', '#38454a', [wx + bar * .4, y - .51, front + .8], [.028, .55, .028]))
                }
            }
        }
        add(part('stone', '#ded0b7', [x, 1.15, front + .07], [1.18, 2.3, .2]),
            part('wood', '#435a55', [x, 1.075, front + .2], [.96, 2.15, .1]),
            part('glass', '#31474b', [x, 1.61, front + .27], [.66, .64, .025]),
            part('metal', '#b19c6b', [x + .32, .99, front + .3], [.035, .16, .04]))
        for (const side of [-1, 1]) {
            const shop = side * width * .3
            add(part('wood', variation % 2 ? '#405c57' : '#5a5950', [x + shop, 1.27, front + .08], [width * .26, 2.25, .13]),
                part('glass', '#293f44', [x + shop, 1.35, front + .16], [width * .23, 1.85, .02]),
                part('cloth', variation % 2 ? '#6e5449' : '#506b5f', [x + shop, 2.53, front + .37], [width * .29, .12, .75], 'box', [.15, 0, 0]))
        }
        for (const side of [-1, 1]) {
            const edge = x + side * (width / 2 - .08)
            for (let y = .3; detailed && y < height; y += .6) add(part('stone', '#d4cab6', [edge, y, front + .04], [.23, .52, .1]))
            add(part('metal', '#677170', [edge, height / 2, front + .23], [.055, height, .055], 'cylinder'))
        }
    }
}

/** Character hulls/sensors stay fixed; only decorative limbs articulate. */
export function actorKit(kind: 'crs' | 'robot', walk: number, shield: boolean): Part[] {
    const p: Part[] = [], add = (...parts: Part[]) => p.push(...parts)
    if (kind === 'crs') {
        add(part('cloth', '#263e59', [0, 1.1, 0], [.59, .64, .43], 'sphere'),
            part('metal', '#2c3c4b', [0, 1.13, .16], [.47, .42, .16]),
            part('cloth', '#24384c', [0, .76, 0], [.46, .24, .36], 'sphere'),
            part('cloth', '#7e8277', [0, 1.48, .02], [.17, .16, .18], 'sphere'),
            part('metal', '#273b50', [0, 1.67, 0], [.47, .4, .48], 'sphere'),
            part('metal', '#405773', [0, 1.78, -.01], [.47, .1, .43], 'sphere'),
            part('cloth', '#aa9d85', [0, 1.565, .224], [.24, .16, .07], 'sphere'),
            part('glass', '#9cbfcd', [0, 1.635, .262], [.42, .2, .044]),
            part('cloth', '#172b3c', [0, .88, .02], [.49, .065, .4]),
            part('metal', '#9caaa9', [0, .89, .228], [.07, .055, .02]))
        // Readable CRS chest identifier, original small geometric letter strokes.
        const letters = [[-.095, 0, .015, .055], [-.077, .024, .04, .01], [-.077, -.024, .04, .01],
            [-.02, 0, .012, .055], [0, .022, .04, .012], [.014, .006, .012, .03], [0, -.003, .04, .01], [.014, -.02, .012, .025],
            [.07, .022, .04, .012], [.055, .009, .012, .03], [.07, 0, .04, .01], [.085, -.012, .012, .03], [.07, -.024, .04, .01]]
        for (const [x, y, w, h] of letters) add(part('metal', '#c4d2ce', [x, 1.275 + y, .249], [w, h, .006]))
        for (const side of [-1, 1]) {
            const swing = Math.sin(walk + (side < 0 ? Math.PI : 0)) * .23
            add({ ...part('cloth', '#2e445b', [side * .15, .6, swing * .25], [.23, .42, .27], 'cylinder', [swing, 0, side * .03]), motion: 'leg' },
                { ...part('cloth', '#253b52', [side * .16, .32, swing * .35], [.18, .32, .22], 'cylinder', [-swing * .45, 0, 0]), motion: 'leg' },
                { ...part('metal', '#3d5061', [side * .16, .45, .125], [.17, .18, .07], 'sphere'), motion: 'leg' },
                { ...part('metal', '#182a35', [side * .16, .12, .07], [.22, .2, .34]), motion: 'leg' },
                part('cloth', '#344a61', [side * .275, 1.29, -.015], [.22, .22, .29], 'sphere'),
                { ...part('cloth', '#2c435b', [side * .315, 1.14, -.015], [.17, .32, .21], 'cylinder', [-swing * .5, 0, side * .15]), motion: 'arm' },
                { ...part('cloth', '#273e54', [side * .315, .94, .07], [.145, .27, .19], 'cylinder', [-.55, 0, 0]), motion: 'arm' },
                { ...part('metal', '#293c47', [side * .315, .84, .15], [.14, .16, .17], 'sphere'), motion: 'arm' })
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
        add(part('metal', '#a8a99b', [0, 1.13, -.025], [.89, 1.06, .73]),
            part('metal', '#798984', [0, 1.68, -.015], [.67, .35, .57]),
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
    if (kind === 'robot') for (const piece of p) {
        if (Math.abs(piece.at[0]) >= .16 && piece.at[1] < .7) piece.motion = 'leg'
        else if (Math.abs(piece.at[0]) >= .35 && piece.at[1] >= .8 && piece.at[1] <= 1.3) piece.motion = 'arm'
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

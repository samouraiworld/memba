/**
 * Text as Gno's unicode.IsPrint takes it: letters, marks, numbers,
 * punctuation, symbols and the ASCII space, by the Unicode 15.0.0 tables the
 * chain runs (gnovm/stdlibs/unicode/tables.gno, the same as Go's). A browser
 * on a newer Unicode prints characters the chain refuses (U+1C89, U+2FFC,
 * U+31EF, …), so text a realm checks with IsPrint is checked here, never by
 * the browser's own tables: a refused transaction still costs its fee.
 *
 * @module lib/gnoPrintable
 */

/**
 * The printable code points as ranges, generated from Go's unicode.IsPrint
 * (Unicode 15.0.0): each is "gap.length" in base 36, the gap counted from the
 * end of the previous range and the length less one. When the chain moves to
 * another Unicode version, run this with a Go whose unicode.Version matches
 * the chain's tables, paste its second line here, and update the count the
 * test pins:
 *
 *     package main
 *
 *     import ("fmt"; "strconv"; "strings"; "unicode")
 *
 *     func main() {
 *         var out []string
 *         end := -1
 *         for r := 0; r <= unicode.MaxRune; r++ {
 *             if !unicode.IsPrint(rune(r)) {
 *                 continue
 *             }
 *             start := r
 *             for r < unicode.MaxRune && unicode.IsPrint(rune(r+1)) {
 *                 r++
 *             }
 *             out = append(out, strconv.FormatInt(int64(start-end-1), 36)+"."+strconv.FormatInt(int64(r-start), 36))
 *             end = r
 *         }
 *         fmt.Println(unicode.Version, len(out))
 *         fmt.Println(strings.Join(out, ","))
 *     }
 */
const RANGES =
    "w.2m,y.b,1.jt,2.5,4.6,1.0,1.j,1.b0,1.11,2.1d,2.2,1.1i,8.q,4.5,h.l,1.5b,1.1b,2.1m,2.2s,e.1m,2.1c,2.e,1.r,2.0," +
    "1.a,5.u,9.21,1.4g,1.7,2.1,2.l,1.6,1.0,3.3,2.8,2.1,2.3,8.0,4.1,1.4,2.o,2.2,1.5,4.1,2.l,1.6,1.1,1.1,1.1,2.0,1.4," +
    "4.1,2.2,3.0,7.3,1.0,7.g,a.2,1.8,1.2,1.l,1.6,1.1,1.4,2.9,1.2,1.2,2.0,f.3,2.b,7.6,1.2,1.7,2.1,2.l,1.6,1.1,1.4," +
    "2.8,2.1,2.2,7.2,4.1,1.4,2.h,a.1,1.5,3.2,1.3,3.1,1.0,1.1,3.1,3.2,3.b,4.4,3.2,1.3,2.0,6.0,e.k,5.c,1.2,1.m,1.f," +
    "2.8,1.2,1.3,7.1,1.2,2.0,2.3,2.9,7.l,1.2,1.m,1.9,1.4,2.8,1.2,1.3,7.1,6.1,1.3,2.9,1.2,c.c,1.2,1.1e,1.2,1.5,4.f," +
    "2.p,1.2,1.h,3.n,1.8,1.0,2.6,3.0,4.5,1.0,1.7,6.9,2.2,c.1l,4.s,11.1,1.0,1.4,1.n,1.0,1.m,2.4,1.0,1.6,1.9,2.3,w.1z," +
    "1.z,4.12,1.z,1.e,1.c,11.5h,1.0,5.0,2.ag,1.3,2.6,1.0,1.3,2.14,1.3,2.w,1.3,2.6,1.0,1.3,2.e,1.1k,1.3,2.1u,2.v,3.p," +
    "6.2d,2.5,2.hr,1.r,3.2g,7.l,9.n,9.j,c.c,1.2,1.1,c.2l,2.9,6.9,6.d,1.a,6.2g,7.16,5.1x,a.u,1.b,4.b,4.0,3.15,2.4," +
    "b.17,4.p,6.a,3.1p,2.1s,1.s,2.a,6.9,6.d,2.u,1d.24,3.1a,1.37,8.1n,3.e,3.1n,7.16,2.a,8.16,5.et,2.5,2.11,2.5,2.7," +
    "1.0,1.0,1.0,1.u,2.1g,1.e,1.d,2.5,1.i,2.2,1.8,h.n,8.1a,h.1,2.q,1.c,3.w,f.w,f.3v,4.ie,p.a,l.1eb,2.v,1.9o,5.18," +
    "1.0,5.0,2.1j,7.1,e.n,9.6,1.6,1.6,1.6,1.6,1.6,1.6,1.6,1.3h,y.p,1.2g,c.5x,q.b,5.1q,1.2d,2.2u,5.16,1.2l,1.2b,c.1a," +
    "1.mlo,3.1i,9.9n,k.53,8.5m,5.1,1.0,1.4,o.1m,3.9,6.1j,8.1x,8.b,6.37,b.t,3.25,1.a,4.w,1.1i,9.d,2.9,2.2u,o.r,a.5," +
    "2.5,2.5,9.6,1.6,1.1n,4.3h,2.9,6.8mb,c.m,4.1c,6is.a5,2.2x,12.6,c.4,5.p,1.4,1.0,1.1,1.1,1.3g,g.cc,2.1h,7.0,w.15," +
    "6.1e,1.i,1.3,4.4,1.3q,4.59,3.5,2.5,2.5,2.2,3.6,1.6,d.1,2.b,1.p,1.i,1.1,1.e,2.d,y.3e,5.2,4.18,3.2f,1.c,3.0," +
    "1b.19,3m.s,3.1c,f.r,4.z,9.t,5.16,5.t,1.10,4.d,16.4d,2.9,6.z,4.z,4.13,8.1f,b.b,1.e,1.6,1.1,1.a,1.e,1.6,1.1," +
    "1v.8m,9.l,a.7,o.5,1.15,1.8,1x.5,2.0,1.17,1.1,3.0,2.m,1.1z,8.8,1c.i,1.1,5.w,3.q,5.0,1s.1j,4.j,2.1d,1.1,5.7,1.2," +
    "1.s,2.2,4.9,7.8,7.1r,w.12,4.b,9.1h,3.s,2.q,5.p,7.3,c.6,28.20,1j.1e,d.1e,7.19,8.9,86.u,1.15,1.2,2.1,23.16,8.15," +
    "m.p,12.r,k.m,9.25,4.z,9.1p,1.4,d.o,7.9,6.1g,1.h,8.12,9.2n,1.j,b.h,1.1a,1q.6,1.0,1.3,1.e,1.a,6.1m,5.9,6.3,1.7," +
    "2.1,2.l,1.6,1.1,1.4,1.9,2.1,2.2,2.0,6.0,5.6,2.6,3.4,3v.2j,1.4,u.1z,8.9,4m.1h,2.11,y.1w,b.9,6.c,j.1l,6.9,1i.q," +
    "2.e,4.m,55.1n,2s.2a,c.7,2.0,2.7,1.1,1.t,1.1,2.b,9.9,1y.7,2.19,2.a,r.1z,8.2a,d.20,7.9,6u.8,1.18,1.d,a.s,3.v,2.l," +
    "1.d,21.6,1.1,1.17,3.0,1.1,1.8,8.9,6.5,1.1,1.10,1.1,1.5,7.9,8m.o,7.g,1.14,3.r,2e.0,f.1d,d.pm,2u.32,1.4,b.5f," +
    "218.2q,d.tr,g.l,33e.g6,6nt.fs,7.u,1.9,4.28,1.9,6.t,2.5,a.1x,a.9,1.6,1.k,5.i,j4.2i,2t.22,4.1k,7.g,1s.4,b.1," +
    "e.4qf,8.yd,16.8,6w7.3,1.6,1.1,1.82,f.0,t.2,2.0,e.3,8.az,1s4.2y,5.c,3.8,7.9,2.3,3mo.19,2.m,9.37,1o.6t,a.12,2.21," +
    "8.33,l.1x,3e.j,c.j,c.2e,9.o,3r.2c,1.1y,1.1,2.0,2.1,2.3,1.b,1.0,1.6,1.1s,1.3,2.7,1.6,1.r,1.3,1.4,1.0,3.6,1.9f," +
    "2.83,2.jh,f.4,1.e,uo.u,6.5,5x.6,1.g,2.6,1.1,1.4,5.1p,x.0,34.18,3.d,2.9,4.1,8w.u,h.1l,5.0,cw.15,km.6,1.3,1.1," +
    "1.e,1.5g,2.f,15.23,4.9,4.1,lt.1v,24.1o,5e.3,1.q,1.1,1.0,2.0,1.9,1.3,1.0,1.0,6.0,4.0,1.0,1.0,1.2,1.1,1.0,2.0," +
    "1.0,1.0,1.0,1.0,1.1,1.0,2.3,1.6,1.3,1.3,1.0,1.9,1.g,5.2,1.4,1.g,1g.1,7i.17,4.2r,c.e,2.e,1.e,1.10,a.4t,1k.s," +
    "d.17,4.8,7.1,e.5,4a.rb,4.g,3.c,3.3a,4.2m,6.b,4.0,f.b,4.1j,8.9,6.13,8.t,2.1,26.9f,c.d,2.c,3.8,7.19,1.6,8.d,4.8," +
    "7.8,7.42,1.1i,11.9,sm.wyn,w.37d,6.65,2.4g1,e.5rk,2e7.f1,15u.3t6,5.38f,f9e8.6n"

let table: Uint32Array | null = null

function ranges(): Uint32Array {
    if (table) return table
    const out: number[] = []
    let end = -1
    for (const item of RANGES.split(",")) {
        const [gap, length] = item.split(".").map((n) => parseInt(n, 36))
        const start = end + 1 + gap
        end = start + length
        out.push(start, end)
    }
    table = Uint32Array.from(out)
    return table
}

/** Whether Gno's unicode.IsPrint takes this code point. */
export function isGnoPrintableCodePoint(code: number): boolean {
    const t = ranges()
    let lo = 0, hi = t.length / 2 - 1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (code < t[2 * mid]) hi = mid - 1
        else if (code > t[2 * mid + 1]) lo = mid + 1
        else return true
    }
    return false
}

/** Whether every character of s is one Gno's unicode.IsPrint takes. */
export function isGnoPrintable(s: string): boolean {
    for (const c of s) if (!isGnoPrintableCodePoint(c.codePointAt(0)!)) return false
    return true
}

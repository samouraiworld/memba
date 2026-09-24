/** g1abcdef…wxyz */
export function shortAddr(a: string): string {
    return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}


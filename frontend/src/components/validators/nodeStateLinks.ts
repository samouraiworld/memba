/** A node often advertises a local listen address in /status. Only link to a
 * clearly public HTTP endpoint; keep local and private values as plain text. */
export function publicRpcLink(raw: string): string | undefined {
    if (!raw.trim()) return undefined
    try {
        const candidate = raw.replace(/^tcp:\/\//i, "http://")
        const url = new URL(candidate.includes("://") ? candidate : `http://${candidate}`)
        if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
        if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan")) return undefined
        if (host.includes(":")) {
            // A public IPv6 address is in 2000::/3. Link-local, unique-local,
            // loopback, and unspecified addresses must never become links.
            if (!/^[23][0-9a-f]{3}:/i.test(host)) return undefined
        } else if (/^\d+(?:\.\d+){3}$/.test(host)) {
            const octets = host.split(".").map(Number)
            if (octets.some(n => n > 255) || octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
                octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254) ||
                (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
                (octets[0] === 192 && octets[1] === 168) ||
                (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)) return undefined
        } else if (!host.includes(".")) return undefined
        return url.href
    } catch { return undefined }
}

/** Read an address-owned Home realm without treating its content as a verified credential. */
import { GNO_CHAIN_ID, getExplorerBaseUrl } from "../../lib/config"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { assertRpcChain } from "../../lib/dao/chainIdentity"
import { resilientAbciQueryDetailed } from "../../lib/rpcFallback"

export type HomeRead =
    | { status: "found"; path: string; url: string; title: string; summary: string }
    | { status: "missing" | "unavailable"; path: string; url: string }

export function homeRealmPath(address: string): string {
    if (!isValidGnoAddressChecksum(address)) throw new Error("Invalid Home address.")
    return `gno.land/r/${address}/home`
}

/** Render output can contain very large inline SVGs. Show plain text only. */
export function homeExcerpt(markdown: string): { title: string; summary: string } {
    const clean = markdown.slice(0, 500_000)
        .replace(/!\[[^\]]*\]\(data:image\/[^)]*\)/gi, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
    const lines = clean.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const heading = lines.find(line => /^#{1,3}\s+/.test(line))
    const title = (heading?.replace(/^#{1,3}\s+/, "") || "Personal Home").slice(0, 100)
    const summary = lines.filter(line => !/^#{1,6}\s+/.test(line) && !/^[-*|>]+\s*$/.test(line) && !/^\|/.test(line))
        .join(" ").replace(/\s+/g, " ").trim().slice(0, 420)
    return { title, summary }
}

export async function readHomeRealm(address: string): Promise<HomeRead> {
    const path = homeRealmPath(address)
    const url = `${getExplorerBaseUrl()}/${path.slice("gno.land/".length)}`
    try {
        const result = await resilientAbciQueryDetailed("vm/qrender", `${path}:`, rpc => assertRpcChain(rpc, GNO_CHAIN_ID))
        if (result.kind === "ok") return { status: "found", path, url, ...homeExcerpt(result.text) }
        // An empty qrender reply cannot prove that a realm exists.
        if (result.kind === "empty") return { status: "unavailable", path, url }
        const reason = `${result.error.log} ${String(result.error.abciError)}`
        if (/not found|does not exist|unknown package|package .*not exist|unable to find/i.test(reason)) return { status: "missing", path, url }
        return { status: "unavailable", path, url }
    } catch {
        return { status: "unavailable", path, url }
    }
}

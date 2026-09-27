/** A deliberately small command language. It never invokes a local shell. */
import { GNO_CHAIN_ID } from "../../../lib/config"
import { assertRpcChain, RpcChainMismatchError } from "../../../lib/dao/chainIdentity"
import { resilientAbciQueryDetailed } from "../../../lib/rpcFallback"

export const HELP = `Read the chain
  render <realm> [page]
    Render a deployed realm
  file <package> [file]
    List or read on-chain source
  funcs <realm>
    List exported functions
  balance <g1 address>
    Show all on-chain coins
  pkgs <r/namespace[/path]>
    Find deployed paths (up to 50)

Use full gno.land paths or start with r/ or p/. These commands read deployed code; they do not run a local draft. Use ↑/↓ to recall commands. The latest 20 results stay in this window. Type clear to clear it.`

const PKG = /^gno\.land\/(?:r|p)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/
const REALM = /^gno\.land\/r\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/
const ADDRESS = /^g1[02-9ac-hj-np-z]{38}$/
const FILE = /^[a-zA-Z0-9_.-]+$/
const MAX_OUTPUT = 32_000

function display(text: string): string {
    return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n\n[Output shortened. Open the package in Explorer to read the full result.]`
}

function packagePath(input: string, realm = false): string {
    const path = input.startsWith("gno.land/") ? input : `gno.land/${input.replace(/^\//, "")}`
    if (!(realm ? REALM : PKG).test(path)) throw new Error(realm ? "Enter a realm path such as r/demo/boards." : "Enter a package path such as p/nt/avl/v0.")
    return path
}

async function read(path: string, data: string, emptyMessage = "No data returned by this package.",
    errorMessage = "The chain could not read this path. Check that it exists and try again."): Promise<string> {
    let answer: Awaited<ReturnType<typeof resilientAbciQueryDetailed>>
    try {
        answer = await resilientAbciQueryDetailed(path, data, (url) => assertRpcChain(url, GNO_CHAIN_ID, true))
    } catch (error) {
        if (error instanceof RpcChainMismatchError) throw error
        throw new Error("Could not reach the chain. Check your connection and try again.")
    }
    if (answer.kind === "abci-error") throw new Error(errorMessage)
    if (answer.kind === "empty") return emptyMessage
    return display(answer.text)
}

/** Parse one command and return text suitable for a <pre>. No HTML interpretation. */
export async function runReadCommand(line: string): Promise<string> {
    const input = line.trim()
    if (!input || input === "help") return HELP
    if (input.length > 2_000) throw new Error("Command is too long.")
    const [command, ...parts] = input.split(/\s+/)
    if (command === "render") {
        if (parts.length < 1 || parts.length > 2) throw new Error("Usage: render <realm> [page]")
        const pkg = packagePath(parts[0], true)
        const page = parts[1] ?? ""
        if (page && !/^[a-zA-Z0-9_./?=&-]{1,240}$/.test(page)) throw new Error("The page path contains unsupported characters.")
        return read("vm/qrender", `${pkg}:${page}`, "This realm rendered an empty page.",
            "The chain could not render this realm. Check its path or try again later.")
    }
    if (command === "file") {
        if (parts.length < 1 || parts.length > 2) throw new Error("Usage: file <package> [file]")
        const pkg = packagePath(parts[0])
        const filename = parts[1]
        if (filename && (filename === "." || filename === ".." || !FILE.test(filename))) throw new Error("Enter a file name from the package listing.")
        return read("vm/qfile", `${pkg}${filename ? `/${filename}` : ""}`)
    }
    if (command === "funcs") {
        if (parts.length !== 1) throw new Error("Usage: funcs <realm>")
        return read("vm/qfuncs", packagePath(parts[0], true))
    }
    if (command === "balance") {
        if (parts.length !== 1 || !ADDRESS.test(parts[0])) throw new Error("Usage: balance <g1 address>")
        return read(`bank/balances/${parts[0]}`, "")
    }
    if (command === "pkgs") {
        if (parts.length !== 1) throw new Error("Usage: pkgs <r/namespace[/path]>")
        const pkg = packagePath(parts[0])
        return read("vm/qpaths?limit=50", `${pkg}/`, "No matching deployed paths.")
    }
    throw new Error(`Unknown command “${command}”. Type help for available commands.`)
}

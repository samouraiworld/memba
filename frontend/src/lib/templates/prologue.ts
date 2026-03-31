/**
 * Template Prologue — shared code generation utilities for Gno realm templates.
 *
 * Generates the common elements that appear at the top of every generated realm:
 * - Package declaration
 * - Import blocks (chain/runtime, chain/banker, chain, etc.)
 * - gnomod.toml file content
 *
 * This DRYs the boilerplate that was previously duplicated across 7 template files.
 *
 * @module lib/templates/prologue
 */

import { extractPkgName } from "./sanitizer"

// ── Import Block Generation ─────────────────────────────────

/** Standard Gno imports available for templates. */
export type GnoImport =
    | "chain/runtime"   // PreviousRealm, CurrentRealm, ChainHeight
    | "chain/banker"    // NewBanker, OriginSend, BankerTypeRealmSend
    | "chain"           // Coins, NewCoin
    | "strconv"         // Atoi, Itoa, FormatInt, etc.
    | "strings"         // Split, Join, TrimSpace, etc.
    | "gno.land/p/demo/avl"    // AVL tree
    | "gno.land/p/demo/ufmt"   // Sprintf formatting

/**
 * Generate a Gno import block from a list of imports.
 * Groups standard library imports first, then third-party packages.
 */
export function generateImportBlock(imports: GnoImport[]): string {
    const stdlib: string[] = []
    const external: string[] = []

    for (const imp of imports) {
        if (imp.startsWith("gno.land/")) {
            external.push(`\t"${imp}"`)
        } else {
            stdlib.push(`\t"${imp}"`)
        }
    }

    const sections: string[] = []
    if (stdlib.length > 0) sections.push(stdlib.join("\n"))
    if (external.length > 0) sections.push(external.join("\n"))

    return `import (\n${sections.join("\n\n")}\n)`
}

// ── gnomod.toml Generation ──────────────────────────────────

/**
 * Generate gnomod.toml content for a realm deployment.
 * Uses `module` field (NOT `pkgpath` — fixed in v2.9.2 B6).
 */
export function generateGnomodToml(realmPath: string): string {
    return `module = "${realmPath}"\ngno = "0.9"\n`
}

// ── Package Declaration ─────────────────────────────────────

/**
 * Generate the package declaration line from a realm path.
 */
export function generatePackageDecl(realmPath: string): string {
    return `package ${extractPkgName(realmPath)}`
}

// ── MsgAddPackage Builder ───────────────────────────────────

/**
 * Build a MsgAddPackage Amino message for Adena DoContract.
 * Shared across all template generators that deploy realms.
 *
 * Files are sorted alphabetically (Gno convention).
 */
export function buildDeployMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit = "",
): {
    type: string
    value: {
        creator: string
        package: { name: string; path: string; files: { name: string; body: string }[] }
        deposit: string
    }
} {
    const pkgName = extractPkgName(realmPath)
    const files = [
        { name: `${pkgName}.gno`, body: code },
        { name: "gnomod.toml", body: generateGnomodToml(realmPath) },
    ].sort((a, b) => a.name.localeCompare(b.name))

    return {
        type: "/vm.m_addpkg",
        value: {
            creator: callerAddress,
            package: { name: pkgName, path: realmPath, files },
            deposit: deposit || "",
        },
    }
}

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

import { extractPkgName, requireRealmPath } from "./sanitizer"

// ── Import Block Generation ─────────────────────────────────

/** Standard Gno imports available for templates. */
export type GnoImport =
    | "chain/runtime"        // ChainHeight (test13/interrealm-v2)
    | "chain/runtime/unsafe" // PreviousRealm, CurrentRealm, OriginSend, OriginCaller
    | "chain/banker"         // NewBanker(type, cur), BankerTypeRealmSend
    | "chain"                // Coins, NewCoin
    | "strconv"         // Atoi, Itoa, FormatInt, etc.
    | "strings"         // Split, Join, TrimSpace, etc.
    | "gno.land/p/nt/avl/v0"   // AVL tree (matches deployed contracts on test12)
    | "gno.land/p/nt/ufmt/v0"  // Sprintf formatting (matches deployed contracts)
    // Legacy aliases (DO NOT USE — kept only so old code doesn't break during migration):
    | "gno.land/p/demo/avl"
    | "gno.land/p/demo/ufmt"

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
    // realmPath lands inside a quoted TOML value; a quote or newline in it would
    // break out and rewrite the module manifest of a realm that is immutable
    // once deployed. See the note on buildDeployMsg below for why the check
    // belongs here and not only in the callers.
    requireRealmPath("realmPath", realmPath)
    return `module = "${realmPath}"\ngno = "0.9"\n`
}

// ── Package Declaration ─────────────────────────────────────

/**
 * Generate the package declaration line from a realm path.
 */
export function generatePackageDecl(realmPath: string): string {
    // The path's last segment becomes the package name; a newline in it closes
    // the declaration and everything after is injected as realm source.
    requireRealmPath("realmPath", realmPath)
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
    // Validate HERE, at the shared choke point, not only in each generator.
    //
    // Every current caller happens to be safe: each generateXCode() calls
    // requireRealmPath and would throw before this runs, and CreateDAO.tsx:269
    // — the one place that calls buildDeployMsg directly — generates the code
    // from the same config first. But this function's own doc comment tells
    // people to "use buildDeployMsg from templates/prologue directly", so the
    // encouraged entry point is the unvalidated one, and the next flow built on
    // it inherits no protection. Checking at the choke point makes the class
    // structurally impossible rather than a convention every caller must recall.
    requireRealmPath("realmPath", realmPath)
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

// Preserve legacy values as fallbacks; the full design preview supplies readable sizes.
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve('src')
const files = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx$/.test(p) && !/\.(test|spec)\./.test(p)) files.push(p)
  }
}
for (const dir of ['pages', 'components', 'plugins']) walk(path.join(root, dir))
const changed = []
for (const file of files) {
  // Game canvases, timelines and fixed pixel art have their own scale.
  if (/\/games?\/|SpaceInvaders|Barricade|BlockParty|professional|ProDAO|ProProposal/.test(path.relative(root, file))) continue
  const source = fs.readFileSync(file, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'fontSize' && ts.isNumericLiteral(node.initializer)) {
      const n = Number(node.initializer.text)
      const token = n <= 11 ? 'caption' : n <= 13 ? 'small' : n <= 15 ? 'body' : null
      if (token) edits.push([node.initializer.getStart(tree), node.initializer.end, `"var(--pro-${token}, ${n}px)"`])
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'fontFamily' && ts.isStringLiteral(node.initializer) && node.initializer.text === 'JetBrains Mono, monospace') {
      let container = node.parent
      while (container && !ts.isJsxElement(container) && !ts.isJsxSelfClosingElement(container) && !ts.isVariableDeclaration(container)) container = container.parent
      const context = container?.getText(tree) || ''
      // Preserve technical data and code. Ordinary interface copy uses the sans token.
      const technical = context.length < 1600 && /<(?:code|pre)\b|className=["'][^"']*mono|\{[^}]*[Aa]ddress|\{[^}]*[Hh]ash|\{[^}]*realmPath|\{[^}]*pubkey/.test(context)
      if (!technical) edits.push([node.initializer.getStart(tree), node.initializer.end, '"var(--font-ui, JetBrains Mono, monospace)"'])
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (edits.length) {
    let result = source
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + replacement + result.slice(end)
    fs.writeFileSync(file, result)
    changed.push({ file: path.relative(process.cwd(), file), declarations: edits.length })
  }
}
console.log(JSON.stringify(changed, null, 2))

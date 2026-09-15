import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
let files = 0, declarations = 0
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name)
    if (e.isDirectory()) { walk(file); continue }
    if (!file.endsWith('.css') || /game|blockparty|professional|pro-ui/.test(file)) continue
    const css = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file })
    let count = 0
    css.walkDecls(d => {
      const selector = d.parent.selector || ''
      if (d.prop === 'font-size' && /^(?:(?:[89]|1[0-5])(?:\.\d+)?px|0\.\d+rem)$/.test(d.value) && !/icon|avatar|emoji/.test(selector)) {
        const n = parseFloat(d.value) * (d.value.endsWith('rem') ? 16 : 1), token = n <= 11 ? 'caption' : n <= 13 ? 'small' : 'body'
        d.value = `var(--pro-${token}, ${d.value})`; count++
      }
      if (d.prop === 'font-family' && /Mono|monospace|--font-mono/.test(d.value) && !/code|pre\b|addr|hash|amount|balance|price|value|metric|block|mono|number|chart/.test(selector) && !d.value.includes('--font-ui')) {
        d.value = `var(--font-ui, ${d.value})`; count++
      }
    })
    if (count) { fs.writeFileSync(file, css.toString()); files++; declarations += count }
  }
}
for (const dir of ['src/pages','src/components','src/plugins']) walk(dir)
console.log({ files, declarations })

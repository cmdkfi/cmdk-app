// PRD §8a: screens and components never call wagmi, viem, NEAR RPC or the relayer directly;
// they go through src/adapters. The sandbox adapter never reaches live code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = dirname(fileURLToPath(import.meta.url))
const PURE_PROTOCOL = new Set(['wallet-utils.ts', 'protection-clock.ts', 'verification-age.ts', 'use-now.ts'])
const ADAPTER_ENTRY = new Set(['adapters/AdapterProvider.tsx', 'adapters/types.ts'])

async function sources(dir) {
  const entries = await readdir(join(src, dir), { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter(e => e.isFile() && /\.(ts|tsx)$/.test(e.name)).map(e => relative(src, join(e.parentPath ?? e.path, e.name)))
}

function imports(text) {
  const found = []
  const pattern = /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm
  for (const match of text.matchAll(pattern)) found.push({ typeOnly: Boolean(match[2]), spec: match[3] ?? match[4] })
  return found
}

const external = spec => /^(wagmi|viem|@wagmi\/)/.test(spec) || spec === 'wagmi' || spec === 'viem'

async function violations(files, rule) {
  const out = []
  for (const file of files) {
    const text = await readFile(join(src, file), 'utf8')
    for (const item of imports(text)) {
      const target = item.spec.startsWith('.') ? relative(src, resolve(join(src, dirname(file)), item.spec)) : item.spec
      const problem = rule(item, target)
      if (problem) out.push(`${file}: ${item.spec} (${problem})`)
    }
  }
  return out
}

test('screens, components and main.tsx use adapters, not wagmi/viem/protocol I/O', async () => {
  const files = [...await sources('screens'), ...await sources('components'), 'main.tsx']
  assert.ok(files.length >= 5, `expected UI sources, found ${files.length}`)
  const found = await violations(files, (item, target) => {
    if (external(item.spec)) return item.typeOnly ? null : 'wagmi/viem'
    if (target.startsWith('protocol/')) return item.typeOnly || PURE_PROTOCOL.has(target.slice('protocol/'.length)) ? null : 'protocol module'
    if (target.startsWith('adapters/')) return ADAPTER_ENTRY.has(target) ? null : 'adapter implementation'
    return null
  })
  assert.deepEqual(found, [])
})

test('sandbox adapter never imports live adapters, wagmi, viem or protocol code at runtime', async () => {
  const files = await sources('adapters/sandbox')
  assert.ok(files.length >= 1)
  const found = await violations(files, (item, target) => {
    if (item.typeOnly) return null
    if (external(item.spec)) return 'wagmi/viem'
    if (target.startsWith('protocol/') || target.startsWith('adapters/live')) return 'live code'
    return null
  })
  assert.deepEqual(found, [])
})

test('the boundary scanner sees value and type imports', () => {
  assert.deepEqual(imports("import { a } from 'wagmi'\nimport type { B } from '../protocol/near.ts'\nimport './x.css'"), [
    { typeOnly: false, spec: 'wagmi' }, { typeOnly: true, spec: '../protocol/near.ts' }, { typeOnly: false, spec: './x.css' },
  ])
})

// PRD §8a/§8b: screens, components and flow never call wagmi, viem, NEAR RPC or the relayer directly, and import
// nothing from protocol/ (not even types): adapters are its only consumers. The sandbox adapter never reaches live code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = dirname(fileURLToPath(import.meta.url))
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

test('screens, components and main.tsx use adapters, not wagmi/viem/protocol', async () => {
  const files = [...await sources('screens'), ...await sources('components'), 'main.tsx']
  assert.ok(files.length >= 5, `expected UI sources, found ${files.length}`)
  const found = await violations(files, (item, target) => {
    if (external(item.spec)) return item.typeOnly ? null : 'wagmi/viem'
    if (target.startsWith('protocol/')) return 'protocol module'
    if (target.startsWith('adapters/')) return ADAPTER_ENTRY.has(target) ? null : 'adapter implementation'
    return null
  })
  assert.deepEqual(found, [])
})

test('flow imports nothing from protocol/ or adapter implementations; only adapter types', async () => {
  const files = await sources('flow')
  assert.ok(files.length >= 5)
  const found = await violations(files, (item, target) => {
    if (target.startsWith('protocol/')) return 'protocol module'
    if (target.startsWith('adapters/')) return target === 'adapters/types.ts' && item.typeOnly ? null : 'adapter implementation'
    if (/^(wagmi|@wagmi\/)/.test(item.spec)) return 'wagmi'
    return null
  })
  assert.deepEqual(found, [])
})

test('only adapters/live imports protocol/', async () => {
  const all = (await sources('.')).filter(file => !file.startsWith('protocol/'))
  const offenders = []
  for (const file of all) {
    const text = await readFile(join(src, file), 'utf8')
    for (const item of imports(text)) {
      const target = item.spec.startsWith('.') ? relative(src, resolve(join(src, dirname(file)), item.spec)) : item.spec
      if (target.startsWith('protocol/') && !file.startsWith('adapters/live/')) offenders.push(`${file}: ${item.spec}`)
    }
  }
  assert.ok(all.some(file => file.startsWith('adapters/live/')))
  assert.deepEqual(offenders, [])
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

import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '..')
const target = resolve(appRoot, 'public/prototype')

await mkdir(resolve(target, 'vendor'), { recursive: true })
await copyFile(resolve(repoRoot, 'index.html'), resolve(target, 'index.html'))
await copyFile(resolve(repoRoot, 'xvf-reference.woff2'), resolve(target, 'xvf-reference.woff2'))
for (const file of await readdir(resolve(repoRoot, 'vendor'))) {
  await copyFile(resolve(repoRoot, 'vendor', file), resolve(target, 'vendor', file))
}

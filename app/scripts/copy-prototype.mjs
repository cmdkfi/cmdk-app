import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
const app = resolve(import.meta.dirname, '..')
const target = resolve(app, 'public/prototype')
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await copyFile(resolve(app, '../xvf-reference.woff2'), resolve(target, 'xvf-reference.woff2'))

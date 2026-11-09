import {readdir,readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {forbiddenMarkers} from './bundle-markers.mjs'
const root=new URL('../dist/',import.meta.url)
const files=await readdir(root,{recursive:true})
assert(files.includes('index.html'),'Build the production application first.')
assert(!files.some(file=>file.startsWith('e2e/')),'Browser test entry must not be deployed.')
// A sandbox build (VITE_SANDBOX=1, Phase 6b) may carry sandbox strings; every other build must not.
const sandbox=process.env.VITE_SANDBOX==='1'
for(const file of files.filter(file=>/\.(js|html|css|json)$/.test(file))){
 const found=forbiddenMarkers(await readFile(new URL(file,root),'utf8'),{sandbox})
 assert.deepEqual(found,[],`Forbidden marker(s) ${found.join(', ')} leaked into ${file}`)
}
console.log(`Production bundle excludes browser fixtures and wallet controls${sandbox?'':', and the sandbox'}.`)

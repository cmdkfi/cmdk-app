import {readdir,readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {forbiddenMarkers} from './bundle-markers.mjs'
const root=new URL('../dist/',import.meta.url)
const files=await readdir(root,{recursive:true})
assert(files.includes('index.html'),'Build the production application first.')
assert(!files.some(file=>file.startsWith('e2e/')),'Browser test entry must not be deployed.')
for(const file of files.filter(file=>/\.(js|html|css|json)$/.test(file))){
 const found=forbiddenMarkers(await readFile(new URL(file,root),'utf8'))
 assert.deepEqual(found,[],`Forbidden marker(s) ${found.join(', ')} leaked into ${file}`)
}
console.log('Production bundle excludes browser fixtures and wallet controls.')

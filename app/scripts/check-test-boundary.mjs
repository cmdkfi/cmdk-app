import {readdir,readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const root=new URL('../dist/',import.meta.url)
const files=await readdir(root,{recursive:true})
assert(files.includes('index.html'),'Build the production application first.')
assert(!files.some(file=>file.startsWith('e2e/')),'Browser test entry must not be deployed.')
for(const file of files.filter(file=>file.endsWith('.js')||file.endsWith('.html'))){
 const content=await readFile(new URL(file,root),'utf8')
 for(const marker of ['fixture.testnet','/e2e/harness','fixtureWallet','fixtureSign'])assert(!content.includes(marker),`Test marker ${marker} leaked into ${file}`)
}
console.log('Production bundle excludes browser fixtures and wallet controls.')

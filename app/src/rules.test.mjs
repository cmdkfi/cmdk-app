import test from 'node:test'
import assert from 'node:assert/strict'
import {editedCorridor} from './rules.ts'
const wad=10n**18n
const c=[wad/2n,wad*7n/10n,wad*3n/10n,wad/5n,false,true,true]
test('editing preserves floor and both permission flags exactly',()=>{
 const args=editedCorridor(c,['55.0','72.0','10.0'],wad*86n/100n)
 assert.equal(args.floor,c[2].toString());assert.equal(args.migrate_allowed,false);assert.equal(args.exit_allowed,true)
 assert.equal(args.target,(wad*55n/100n).toString())
})
test('protocol boundaries and token-style invalid inputs are rejected',()=>{
 for(const values of [['30','70','20'],['50','50.1','20'],['50','86','20'],['50','70','100.1'],['-1','70','20'],['5e1','70','20'],['50.01','70','20']])assert.throws(()=>editedCorridor(c,values,wad*86n/100n))
 assert.doesNotThrow(()=>editedCorridor(c,['50','70','0'],wad*86n/100n))
 assert.throws(()=>editedCorridor([...c.slice(0,6),false],['50','70','20'],wad))
})

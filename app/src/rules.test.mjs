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
import {ruleUpdates,rulesIntent} from './rules.ts'
const primary={id:'0x'+'11'.repeat(32),liquidationLtv:wad*86n/100n},backup={...primary,id:'0x'+'22'.repeat(32)}
test('shared changes preserve each market floor and permissions in the protocol batch',()=>{
 const other=[wad/2n,wad*7n/10n,wad*2n/10n,wad/5n,true,false,true]
 const updates=ruleUpdates([{market:primary,current:c},{market:backup,current:other}],['55.0','72.0','10.0'])
 assert.equal(updates.length,2);assert.equal(updates[0].floor,c[2].toString());assert.equal(updates[1].floor,other[2].toString())
 const intent=rulesIntent(updates)
 assert.equal(intent.method,'setup');assert.equal(intent.args.measurement,null)
 assert.deepEqual(intent.args.markets.map(m=>[m.approve,m.authorize]),[[false,false],[false,false]])
 assert.equal(intent.args.markets[0].corridor.migrate_allowed,false);assert.equal(intent.args.markets[1].corridor.exit_allowed,false)
})
test('enabling shared rules never resubmits the unchanged primary corridor',()=>{
 const other=[wad*55n/100n,...c.slice(1)]
 const updates=ruleUpdates([{market:primary,current:c},{market:backup,current:other}],['50.0','70.0','20.0'])
 assert.equal(updates.length,1);assert.equal(updates[0].market,backup.id);assert.equal(rulesIntent(updates).method,'set_corridor')
 assert.throws(()=>rulesIntent(ruleUpdates([{market:primary,current:c}],['50.0','70.0','20.0'])),/No changes/)
 assert.throws(()=>ruleUpdates([{market:backup,current:[...other.slice(0,2),wad*52n/100n,...other.slice(3)]}],['50','70','20']))
})

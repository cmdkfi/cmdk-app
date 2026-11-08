import test from 'node:test'
import assert from 'node:assert/strict'
import {protectionLabel} from './protection-clock.ts'
test('an Active snapshot expires without another network response',()=>{
 assert.equal(protectionLabel('Active',160,1000,159),'Active')
 assert.equal(protectionLabel('Active',160,1000,160),'Unavailable')
 assert.equal(protectionLabel('Active',160,160,160),'Expired')
 assert.equal(protectionLabel('Active',undefined,1000,100),'Unavailable')
 assert.equal(protectionLabel('Closed for agent',160,1000,200),'Closed for agent')
})

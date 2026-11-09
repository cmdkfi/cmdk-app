import {test} from 'node:test'
import assert from 'node:assert/strict'
import {verificationAge} from './verification-age.ts'
test('verification age preserves one decimal while switching readable units without inventing freshness',()=>{
 assert.equal(verificationAge(12.34),'12.3s ago')
 assert.equal(verificationAge(60),'1.0 min ago')
 assert.equal(verificationAge(2850.6),'47.5 min ago')
 assert.equal(verificationAge(3600),'1.0h ago')
 assert.equal(verificationAge(86400),'1.0d ago')
 assert.equal(verificationAge(-1),'Clock mismatch')
 assert.equal(verificationAge(NaN),'Clock mismatch')
})

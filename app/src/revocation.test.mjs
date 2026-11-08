import test from 'node:test'
import assert from 'node:assert/strict'
import {revocationMessage,revocationConfirmed} from './revocation.ts'
test('revocation uses a fresh owner nonce, bounded expiry, and empty protocol args',()=>{const m=JSON.parse(revocationMessage('v3.factory.testnet','4',1000));assert.deepEqual(m.args,{});assert.equal(m.method,'revoke_agent');assert.equal(m.nonce,5);assert.equal(m.expiry,1600);assert.equal(m.network,'testnet');for(const n of [undefined,-1,NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>revocationMessage('v3.factory.testnet',n,1000));assert.throws(()=>revocationMessage('vault.near',4,1000))})
test('both agent registration and approved measurement must be cleared',()=>{assert.equal(revocationConfirmed({agent:null,approved:null}),true);assert.equal(revocationConfirmed({agent:{public_key:'ed25519:key'},approved:null}),false);assert.equal(revocationConfirmed({approved:{mrtd:'abc'}}),false)})

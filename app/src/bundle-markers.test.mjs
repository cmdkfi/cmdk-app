import test from 'node:test'
import assert from 'node:assert/strict'
import { forbiddenMarkers } from '../scripts/bundle-markers.mjs'

test('bundle check: rejects any "sandbox" or "Sandbox" string unless the build is a sandbox build; always rejects test markers', () => {
  assert.deepEqual(forbiddenMarkers('let a={live:`0.01`}'), [])
  assert.deepEqual(forbiddenMarkers('label:`Sandbox wallet · simulated`'), ['Sandbox'])
  assert.deepEqual(forbiddenMarkers('e===`sandbox`?x:y'), ['sandbox'])
  assert.deepEqual(forbiddenMarkers('onLeaveSandbox:s'), ['Sandbox'])
  assert.deepEqual(forbiddenMarkers('e===`sandbox`', { sandbox: true }), [])
  assert.deepEqual(forbiddenMarkers('factory.fixture.testnet', { sandbox: true }), ['fixture.testnet'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { forbiddenMarkers } from '../scripts/bundle-markers.mjs'

test('bundle check: rejects browser-test markers; the sandbox ships since Phase 6b and is no longer a marker', () => {
  assert.deepEqual(forbiddenMarkers('let a={live:`0.01`}'), [])
  assert.deepEqual(forbiddenMarkers('label:`Sandbox wallet · simulated`'), [])
  assert.deepEqual(forbiddenMarkers('factory.fixture.testnet'), ['fixture.testnet'])
  assert.deepEqual(forbiddenMarkers('window.fixtureWallet'), ['fixtureWallet'])
})

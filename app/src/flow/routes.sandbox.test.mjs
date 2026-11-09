// The sandbox route seams, with the build flag on (a Phase 6b build). Runs in its own process (node --test isolates
// files), so the flag does not leak into the default-build route tests in routes.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.__SANDBOX__ = true
const { hashFor, parseHash } = await import('./routes.ts')

test('sandbox build: #sandbox/… mirrors the five routes and redirects close/closed to position', () => {
  for (const route of ['start', 'settings', 'connect', 'progress', 'position']) {
    assert.deepEqual(parseHash(`#sandbox/${route}`), { place: { mode: 'sandbox', route }, canonical: `#sandbox/${route}`, entry: false })
  }
  assert.equal(parseHash('#sandbox/close').canonical, '#sandbox/position')
  assert.equal(hashFor({ mode: 'sandbox', route: 'start' }), '#sandbox/start')
})

test('sandbox build: #sandbox and unknown sandbox names go to #sandbox/start; nothing resolves into a live route', () => {
  assert.equal(parseHash('#sandbox/closed').canonical, '#sandbox/position')
  assert.equal(parseHash('#sandbox').canonical, '#sandbox/start')
  assert.equal(parseHash('#sandbox/other').canonical, '#sandbox/start')
  for (const hash of ['#sandbox', '#sandbox/', '#sandbox/x', '#sandbox/close', '#sandbox/position']) assert.equal(parseHash(hash).place.mode, 'sandbox')
  assert.equal(hashFor({ mode: 'sandbox', route: 'progress' }), '#sandbox/progress')
})

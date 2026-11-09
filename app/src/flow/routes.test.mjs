import test from 'node:test'
import assert from 'node:assert/strict'
import { hashFor, parseHash } from './routes.ts'

test('bare root is an entry that lands through the resolver', () => {
  for (const hash of ['', '#', '#/']) assert.deepEqual(parseHash(hash), { place: { mode: 'live', route: 'start' }, canonical: '#start', entry: true })
})

test('five live routes parse to themselves and are not entries', () => {
  for (const route of ['start', 'settings', 'connect', 'progress', 'position']) {
    assert.deepEqual(parseHash(`#${route}`), { place: { mode: 'live', route }, canonical: `#${route}`, entry: false })
  }
})

test('unknown live hashes go to #start; close/closed are not live routes', () => {
  for (const hash of ['#vault?id=v1', '#activity', '#close', '#closed', '#nope']) assert.equal(parseHash(hash).canonical, '#start')
  assert.equal(parseHash('#position?x=1').canonical, '#position')
})

test('sandbox mirrors the five routes and redirects close/closed to position', () => {
  for (const route of ['start', 'settings', 'connect', 'progress', 'position']) {
    assert.deepEqual(parseHash(`#sandbox/${route}`).place, { mode: 'sandbox', route })
  }
  assert.equal(parseHash('#sandbox/close').canonical, '#sandbox/position')
  assert.equal(parseHash('#sandbox/closed').canonical, '#sandbox/position')
  assert.equal(parseHash('#sandbox').canonical, '#sandbox/start')
  assert.equal(parseHash('#sandbox/other').canonical, '#sandbox/start')
})

test('sandbox never resolves into a live route', () => {
  for (const hash of ['#sandbox', '#sandbox/', '#sandbox/x', '#sandbox/close', '#sandbox/position']) assert.equal(parseHash(hash).place.mode, 'sandbox')
})

test('hashFor round-trips', () => {
  assert.equal(hashFor({ mode: 'live', route: 'settings' }), '#settings')
  assert.equal(hashFor({ mode: 'sandbox', route: 'progress' }), '#sandbox/progress')
})

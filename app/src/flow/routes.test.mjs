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

test('default build (no sandbox until Phase 6b): every #sandbox/… hash is an unknown route and goes to #start', () => {
  for (const hash of ['#sandbox', '#sandbox/', '#sandbox/start', '#sandbox/position', '#sandbox/close']) {
    assert.deepEqual(parseHash(hash), { place: { mode: 'live', route: 'start' }, canonical: '#start', entry: false })
  }
  assert.equal(hashFor({ mode: 'sandbox', route: 'progress' }), '#progress') // no sandbox hash is ever produced
})

test('hashFor round-trips', () => {
  assert.equal(hashFor({ mode: 'live', route: 'settings' }), '#settings')
})

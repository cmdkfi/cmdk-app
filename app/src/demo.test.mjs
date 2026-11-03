import test from 'node:test'
import assert from 'node:assert/strict'
import { demoReducer, demoLtv, initialDemo } from './demo.ts'

test('local demo carries one position from vault creation through closing', () => {
  let state = demoReducer(initialDemo, { type: 'create', rules: initialDemo.rules })
  assert.equal(state.phase, 'vault')
  state = demoReducer(state, { type: 'open', collateral: 2, ltv: 50 })
  assert.equal(state.debt, 2500)
  assert.equal(state.positionUsdc, 2500)
  state = demoReducer(state, { type: 'withdraw' })
  assert.equal(state.walletUsdc, 5500)
  assert.equal(state.positionUsdc, 0)
  state = demoReducer(state, { type: 'price-drop' })
  assert.equal(Math.round(demoLtv(state) * 10) / 10, 71.4)
  state = demoReducer(state, { type: 'reduce' })
  assert.equal(state.phase, 'protected')
  assert.equal(state.debt, 1000)
  assert.equal(Math.round(demoLtv(state)), 50)
  state = demoReducer(state, { type: 'repay' })
  assert.equal(state.debt, 0)
  state = demoReducer(state, { type: 'close' })
  assert.equal(state.phase, 'closed')
  assert.ok(state.returnedWeth > 1.14 && state.returnedWeth < 1.15)
  assert.equal(state.collateral, 0)
})

test('cannot bypass a required step or exceed the opening limit', () => {
  assert.equal(demoReducer(initialDemo, { type: 'withdraw' }), initialDemo)
  assert.equal(demoReducer(initialDemo, { type: 'open', collateral: 2, ltv: 50 }), initialDemo)
  const vault = demoReducer(initialDemo, { type: 'create', rules: initialDemo.rules })
  assert.equal(demoReducer(vault, { type: 'open', collateral: 2, ltv: 60 }), vault)
})

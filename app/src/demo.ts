export type DemoPhase = 'empty' | 'vault' | 'opened' | 'withdrawn' | 'risk' | 'protected' | 'repaid' | 'closed'
export type DemoRules = { floor: number; target: number; act: number; budget: number; migrate: boolean; exit: boolean }
export type DemoState = {
  phase: DemoPhase
  rules: DemoRules
  collateral: number
  debt: number
  price: number
  positionUsdc: number
  walletUsdc: number
  returnedWeth: number
  events: string[]
}
export type DemoAction =
  | { type: 'create'; rules: DemoRules }
  | { type: 'open'; collateral: number; ltv: number }
  | { type: 'withdraw' }
  | { type: 'price-drop' }
  | { type: 'reduce' }
  | { type: 'repay' }
  | { type: 'close' }
  | { type: 'reset' }

export const initialDemo: DemoState = {
  phase: 'empty',
  rules: { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: true },
  collateral: 0,
  debt: 0,
  price: 2500,
  positionUsdc: 0,
  walletUsdc: 3000,
  returnedWeth: 0,
  events: [],
}

export function demoLtv(state: Pick<DemoState, 'debt' | 'collateral' | 'price'>): number {
  return state.collateral > 0 ? state.debt / (state.collateral * state.price) * 100 : 0
}

export function validRules(rules: DemoRules): boolean {
  return rules.floor >= 0 && rules.floor < rules.target && rules.target + 0.1 < rules.act && rules.act < 86 && rules.budget >= 0 && rules.budget <= 100
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'reset': return initialDemo
    case 'create':
      if (!validRules(action.rules)) return state
      return { ...initialDemo, phase: 'vault', rules: action.rules, events: ['Demo vault created'] }
    case 'open': {
      if (state.phase !== 'vault' || !Number.isFinite(action.collateral) || action.collateral <= 0 || !Number.isFinite(action.ltv) || action.ltv <= 0 || action.ltv > Math.min(50, state.rules.act)) return state
      const debt = Math.round(action.collateral * state.price * action.ltv / 100)
      return { ...state, phase: 'opened', collateral: action.collateral, debt, positionUsdc: debt, events: [`Opened ${debt} USDC loan`, ...state.events] }
    }
    case 'withdraw':
      if (state.phase !== 'opened') return state
      return { ...state, phase: 'withdrawn', walletUsdc: state.walletUsdc + state.positionUsdc, positionUsdc: 0, events: ['Borrowed USDC withdrawn to demo wallet', ...state.events] }
    case 'price-drop':
      if (state.phase !== 'withdrawn') return state
      return { ...state, phase: 'risk', price: 1750, events: ['ETH price fell to $1,750', ...state.events] }
    case 'reduce': {
      if (state.phase !== 'risk' || demoLtv(state) < state.rules.act) return state
      const target = state.rules.target / 100
      const sold = Math.min(state.collateral, Math.max(0, (state.debt - target * state.collateral * state.price) / (state.price * (1 - target))))
      const repaid = Math.min(state.debt, sold * state.price)
      return { ...state, phase: 'protected', collateral: state.collateral - sold, debt: Math.round((state.debt - repaid) * 100) / 100, events: [`Agent sold ${sold.toFixed(3)} WETH and repaid ${Math.round(repaid)} USDC`, ...state.events] }
    }
    case 'repay':
      if (!['withdrawn', 'risk', 'protected'].includes(state.phase) || state.walletUsdc < state.debt) return state
      return { ...state, phase: 'repaid', walletUsdc: state.walletUsdc - state.debt, debt: 0, events: ['Remaining loan repaid from demo wallet', ...state.events] }
    case 'close':
      if (state.phase !== 'repaid') return state
      return { ...state, phase: 'closed', returnedWeth: state.collateral, collateral: 0, events: ['Remaining WETH returned to demo wallet', ...state.events] }
  }
}

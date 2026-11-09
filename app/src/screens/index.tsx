import type { PositionVariant, ProgressStep } from '../flow/entry.ts'
import { Placeholder } from './Placeholder.tsx'

const STEP_LABEL: Record<ProgressStep, string> = {
  create: 'Create your position',
  setup: 'Approve agent and rules',
  deposit: 'Send WETH to your position address',
  open: 'Open position at 50% LTV',
  withdraw: 'Send USDC to your wallet',
}

export function Progress({ step }: { step?: ProgressStep }) {
  return <Placeholder label="S4 · Progress" title="Opening your position" phase="Phase 3">
    {step === 'deposit' && <p className="screen__lead">Your vault is ready. Deposit to open a position.</p>}
    {step && <p className="screen__note">Resumes at: {STEP_LABEL[step]}</p>}
  </Placeholder>
}

const VARIANT_LABEL: Record<PositionVariant, string> = { active: 'Active position', closed: 'Position closed', liquidated: 'Position liquidated' }

export function Position({ variant }: { variant?: PositionVariant }) {
  return <Placeholder label="S5 · Position" title="Your position" phase="Phase 4">
    {variant && <p className="screen__note">{VARIANT_LABEL[variant]}</p>}
  </Placeholder>
}

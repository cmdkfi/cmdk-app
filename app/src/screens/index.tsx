import type { PositionVariant } from '../flow/entry.ts'
import { Placeholder } from './Placeholder.tsx'

const VARIANT_LABEL: Record<PositionVariant, string> = { active: 'Active position', closed: 'Position closed', liquidated: 'Position liquidated' }

export function Position({ variant }: { variant?: PositionVariant }) {
  return <Placeholder label="S5 · Position" title="Your position" phase="Phase 4">
    {variant && <p className="screen__note">{VARIANT_LABEL[variant]}</p>}
  </Placeholder>
}

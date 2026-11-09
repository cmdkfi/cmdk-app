// S1 deposit amount (PRD S1, D7): ETH with 18 decimals, minimum from config, no maximum.
import { parseAmount } from '../protocol/live-actions.ts'

export type AmountCheck =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'below-min' }
  | { kind: 'ok'; wei: bigint }

export function checkDeposit(text: string, minWei: bigint): AmountCheck {
  const value = text.trim()
  if (value === '') return { kind: 'empty' }
  let wei: bigint
  try {
    wei = parseAmount(value, 18)
  } catch (error) {
    return { kind: 'invalid', message: error instanceof Error ? error.message : 'Enter a valid amount.' }
  }
  return wei < minWei ? { kind: 'below-min' } : { kind: 'ok', wei }
}

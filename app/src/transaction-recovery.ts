import { decodeFunctionData, encodeFunctionData, type Hex } from 'viem'
import { morphoActions, params } from './live-actions.ts'
import type { MarketPosition } from './positions.ts'

export type PendingTransaction = { pending?: boolean; kind?: 'owner'; hash?: Hex; job?: string; to?: string; data?: Hex; value?: string; startedAt?: number }
type Transaction = { from: string; to: string | null; input: Hex; value: bigint }

// Legacy records have no intent. Only a manually identified collateral deposit can recover them.
export function validateRecovery(tx: Transaction, record: PendingTransaction, owner: string, vault: string, market: MarketPosition) {
  if (tx.from.toLowerCase() !== owner.toLowerCase()) throw new Error('Transaction belongs to a different wallet.')
  if (record.to && record.data) {
    if (tx.to?.toLowerCase() !== record.to.toLowerCase() || tx.input.toLowerCase() !== record.data.toLowerCase() || tx.value !== BigInt(record.value ?? '0')) throw new Error('Transaction does not match the pending action.')
    return
  }
  if (record.kind === 'owner' || record.job || tx.to?.toLowerCase() !== market.morpho?.toLowerCase() || tx.value !== 0n) throw new Error('Expected a direct Morpho collateral deposit.')
  const call = decodeFunctionData({ abi: morphoActions, data: tx.input })
  if (call.functionName !== 'supplyCollateral' || call.args[1] <= 0n || call.args[2].toLowerCase() !== vault.toLowerCase()) throw new Error('Expected a collateral deposit for this vault.')
  const expected = encodeFunctionData({abi:morphoActions,functionName:'supplyCollateral',args:[params(market),call.args[1],vault as Hex,'0x']})
  if (tx.input.toLowerCase() !== expected.toLowerCase()) throw new Error('Deposit does not match this market.')
}
